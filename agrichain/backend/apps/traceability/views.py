import qrcode
import io
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Batch, QRCodeScanEvent
from .serializers import BatchSerializer, BatchListSerializer, QRCodeScanEventSerializer
from apps.authentication.permissions import IsDistributor
from apps.notifications.models import Notification
from apps.notifications.services import notify


def _scoped_batches(user):
    """
    Batches this user has a legitimate relationship to. Shared by BatchViewSet.get_queryset,
    BatchViewSet.lookup, and QRCodeScanEventViewSet.get_queryset so batch-detail and
    scan-event access always follow the same rules as the batch list — a `lookup` or scan
    query can't bypass scoping just because it takes an id/batch_id directly instead of
    going through the paginated list.
    """
    if user.role == 'COOPERATIVE_MANAGER':
        try:
            return Batch.objects.filter(cooperative=user.cooperative)
        except Exception:
            return Batch.objects.none()
    if user.role == 'DISTRIBUTOR':
        try:
            dist = user.distributor_profile
            # Include both received batches and in-transit batches destined for this distributor
            return Batch.objects.filter(
                Q(received_by_distributor=dist) |
                Q(supply_agreement__produce_request__distributor=dist)
            ).distinct()
        except Exception:
            return Batch.objects.none()
    if user.role in ('TRANSPORTER', 'TRANSPORT_COMPANY'):
        try:
            transporter = user.transporter_profile
            return (
                Batch.objects.filter(transport_request_leg1__transporter=transporter) |
                Batch.objects.filter(transport_request_leg2__transporter=transporter)
            ).distinct()
        except Exception:
            return Batch.objects.none()
    if user.role in ('ADMIN', 'MINAGRI_OFFICER'):
        return Batch.objects.all()
    return Batch.objects.none()


class BatchViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return _scoped_batches(self.request.user)

    def get_serializer_class(self):
        if self.action == 'list':
            return BatchListSerializer
        return BatchSerializer

    def perform_create(self, serializer):
        serializer.save(
            dispatched_by=self.request.user,
            cooperative=self.request.user.cooperative,
        )

    @action(detail=True, methods=['get'])
    def qr(self, request, pk=None):
        batch = self.get_object()
        # Encode a full URL, not a bare UUID — scanning with an ordinary phone camera
        # must open a page, not just display meaningless text.
        track_url = f"{settings.FRONTEND_URL}/track/{batch.batch_id}"
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(track_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        buf.seek(0)
        return HttpResponse(buf, content_type='image/png')

    @action(detail=True, methods=['post'])
    def scan(self, request, pk=None):
        batch = self.get_object()
        scan_point = request.data.get('scan_point')
        if not scan_point:
            return Response({'detail': 'scan_point is required.'}, status=status.HTTP_400_BAD_REQUEST)
        scan = QRCodeScanEvent.objects.create(
            batch=batch,
            scan_point=scan_point,
            scanned_by=request.user,
            gps_latitude=request.data.get('gps_latitude'),
            gps_longitude=request.data.get('gps_longitude'),
        )
        return Response(QRCodeScanEventSerializer(scan).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def iot(self, request, pk=None):
        """Combined GPS + vehicle temperature readings for this batch's trip(s) —
        powers the live vehicle monitoring view for cooperatives/distributors/transporters."""
        batch = self.get_object()
        from apps.iot.models import VehicleIoTReading
        from apps.iot.serializers import VehicleIoTReadingSerializer
        from apps.transport.models import GPSTrack
        from apps.transport.serializers import GPSTrackSerializer

        trip_ids = []
        active_request = None
        latest_request = None
        for req in (batch.transport_request_leg1, batch.transport_request_leg2):
            if not req:
                continue
            # The static pickup->destination route only needs the request's own GPS fields,
            # not a Trip — a Trip (and therefore live GPS/temperature readings) only exists
            # once the transporter has actually picked up. Without this, a batch showed no
            # map at all while still "In Transit — Leg 1", which is exactly when a distributor
            # most wants to see where it's coming from.
            latest_request = req  # leg2 (if present) wins as the most relevant leg
            if hasattr(req, 'trip'):
                trip_ids.append(req.trip.id)
                if not req.trip.delivery_confirmed_at:
                    active_request = req

        readings = VehicleIoTReading.objects.filter(trip_id__in=trip_ids).order_by('-timestamp')[:50]
        gps = GPSTrack.objects.filter(trip_id__in=trip_ids).order_by('timestamp')[:200]
        # Show the route even after delivery — a completed journey, not just an in-progress
        # one — so Traceability always has a real map instead of falling back to text only.
        route_request = active_request or latest_request
        route = None
        if route_request:
            route = {
                'pickup_location': route_request.pickup_location,
                'pickup_gps_lat': route_request.pickup_gps_lat,
                'pickup_gps_lng': route_request.pickup_gps_lng,
                'destination': route_request.destination,
                'destination_gps_lat': route_request.destination_gps_lat,
                'destination_gps_lng': route_request.destination_gps_lng,
                'delivered': hasattr(route_request, 'trip') and bool(route_request.trip.delivery_confirmed_at),
            }
        return Response({
            'temperature_readings': VehicleIoTReadingSerializer(readings, many=True).data,
            'gps_tracks': GPSTrackSerializer(gps, many=True).data,
            'route': route,
            'is_live': active_request is not None,
        })

    @action(detail=False, methods=['get'])
    def lookup(self, request):
        batch_id = request.query_params.get('batch_id')
        if not batch_id:
            return Response({'detail': 'batch_id query param required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            batch = self.get_queryset().get(batch_id=batch_id)
            return Response(BatchSerializer(batch).data)
        except Batch.DoesNotExist:
            return Response({'detail': 'Batch not found.'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'], url_path='confirm-receipt')
    def confirm_receipt(self, request, pk=None):
        """
        Distributor confirms receipt of a batch at their warehouse.
        Records received weight, quality grade, and logs the QR scan event.
        Computes transit loss (leg 1) automatically.
        """
        batch = self.get_object()

        received_qty = request.data.get('received_qty_kg')
        quality = request.data.get('quality_grade_received', '')
        notes = request.data.get('notes', '')

        # Allow re-confirmation (idempotent)
        try:
            dist = request.user.distributor_profile
        except Exception:
            dist = None

        if received_qty is not None:
            batch.weight_at_distributor_kg = received_qty
        batch.quality_at_distributor = quality
        batch.received_by_distributor = dist
        batch.distributor_receipt_timestamp = timezone.now()
        batch.current_status = Batch.Status.AT_DISTRIBUTOR

        # Compute transit loss (dispatch weight vs received weight)
        batch.calculate_transit_loss_leg1()
        batch.calculate_total_loss()
        batch.save()

        # Record the handover scan event
        QRCodeScanEvent.objects.get_or_create(
            batch=batch,
            scan_point=QRCodeScanEvent.ScanPoint.DISTRIBUTOR_RECEIPT,
            defaults={'scanned_by': request.user},
        )

        # ── Shortfall notification to cooperative ───────────────────────────
        # If the distributor flagged that items were never dispatched (as opposed to
        # lost in transit), notify the cooperative immediately with the specific details
        # so they can investigate and respond.
        shortfall_type = request.data.get('shortfall_type')
        loss_reason    = request.data.get('loss_reason', '')
        loss_kg        = float(batch.transit_loss_leg1_kg or 0)

        if shortfall_type == 'NOT_DISPATCHED' and loss_kg > 0 and batch.cooperative:
            from apps.notifications.services import notify
            from apps.notifications.models import Notification
            crop_name   = batch.crop.name if batch.crop else 'produce'
            dist_name   = str(dist) if dist else 'Distributor'
            reason_code = loss_reason.replace('NOT_DISPATCHED:', '').strip().split('—')[0].strip()
            notify(
                batch.cooperative.manager,
                Notification.NotificationType.BATCH_DELIVERED,
                f'Shortfall Report — Batch {str(batch.batch_id)[:8].upper()}',
                f'{dist_name} confirmed receipt of Batch {str(batch.batch_id)[:8].upper()} '
                f'but reports {loss_kg:,.0f} kg of {crop_name} were NOT dispatched from your cooperative. '
                f'Reason given: {reason_code}. '
                f'Expected: {float(batch.dispatch_weight_kg):,.0f} kg | Received: {float(batch.weight_at_distributor_kg or 0):,.0f} kg. '
                f'Please review and confirm whether this quantity was dispatched.',
                related_object_type='batch', related_object_id=batch.id,
            )

        return Response(BatchSerializer(batch).data)

    @action(detail=True, methods=['post'], url_path='report-mismatch', permission_classes=[IsDistributor])
    def report_mismatch(self, request, pk=None):
        """
        Distributor reports that what physically arrived does not match this batch's
        recorded crop — a content/identity mismatch, not a quantity shortfall (which
        confirm_receipt already handles). E.g. the cooperative attached the wrong label
        to the wrong physical produce before dispatch.
        """
        batch = self.get_object()
        description = (request.data.get('description') or '').strip()
        notes = request.data.get('notes', '')
        if not description:
            return Response({'description': ['Describe what was actually received.']}, status=status.HTTP_400_BAD_REQUEST)

        batch.mismatch_reported = True
        batch.mismatch_reported_at = timezone.now()
        batch.mismatch_description = description
        batch.mismatch_notes = notes
        batch.save(update_fields=['mismatch_reported', 'mismatch_reported_at', 'mismatch_description', 'mismatch_notes'])

        if batch.cooperative and batch.cooperative.manager:
            notify(
                batch.cooperative.manager,
                Notification.NotificationType.BATCH_MISMATCH_REPORTED,
                f'Mismatch Reported — Batch {str(batch.batch_id)[:8].upper()}',
                f'{request.user.get_full_name() or request.user.username} reports Batch {str(batch.batch_id)[:8].upper()} '
                f'does not match what was ordered. Expected: {batch.crop.name}. '
                f'Reported as received: {description}.'
                + (f' Notes: {notes}' if notes else ''),
                related_object_type='batch', related_object_id=batch.id,
            )

        return Response(BatchSerializer(batch).data)


class QRCodeScanEventViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = QRCodeScanEventSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = QRCodeScanEvent.objects.filter(batch__in=_scoped_batches(self.request.user))
        batch_id = self.request.query_params.get('batch')
        if batch_id:
            qs = qs.filter(batch_id=batch_id)
        return qs


class PublicBatchTrackView(APIView):
    """
    GET /api/v1/traceability/track/<uuid:batch_id>/ — no authentication required.
    What the QR code printed on a batch label actually points at, so anyone scanning it
    with an ordinary phone camera (a buyer, an auditor, a defense panel) sees the batch's
    chain of custody without needing a ChainSight account. Deliberately exposes only
    non-sensitive fields — no phone numbers, no exact GPS, no internal user identities.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, batch_id=None):
        try:
            batch = Batch.objects.select_related(
                'cooperative', 'crop', 'received_by_distributor',
            ).prefetch_related('qr_scans').get(batch_id=batch_id)
        except (Batch.DoesNotExist, ValueError, TypeError):
            return Response({'detail': 'No batch found for this code.'}, status=status.HTTP_404_NOT_FOUND)

        timeline = [
            {
                'point': 'DISPATCH',
                'label': 'Dispatched from cooperative',
                'timestamp': batch.dispatch_timestamp,
            }
        ]
        for scan in batch.qr_scans.all():
            timeline.append({
                'point': scan.scan_point,
                'label': scan.get_scan_point_display(),
                'timestamp': scan.scanned_at,
            })
        if batch.distributor_receipt_timestamp and not any(
            t['point'] == 'DISTRIBUTOR_RECEIPT' for t in timeline
        ):
            timeline.append({
                'point': 'DISTRIBUTOR_RECEIPT',
                'label': 'Received by distributor',
                'timestamp': batch.distributor_receipt_timestamp,
            })
        timeline.sort(key=lambda t: t['timestamp'])

        # Downstream fan-out summary — a batch dispatched in bulk (e.g. 90,000kg) becomes
        # warehouse stock and is typically sold on to many market agents in small orders.
        # This is a privacy-safe aggregate for an anonymous scanner: no market agent names,
        # just "how many orders/buyers has this batch's stock reached so far".
        from django.db.models import Sum, Count
        allocation_summary = batch.allocations.aggregate(
            total_allocated_kg=Sum('quantity_kg'),
            order_count=Count('order', distinct=True),
            market_agent_count=Count('order__market_agent', distinct=True),
        )

        return Response({
            'batch_id_short': str(batch.batch_id)[:8].upper(),
            'crop_name': batch.crop.name,
            'status': batch.current_status,
            'status_display': batch.get_current_status_display(),
            'origin_cooperative': batch.cooperative.name,
            'origin_district': batch.cooperative.district,
            'dispatch_weight_kg': batch.dispatch_weight_kg,
            'quality_grade_at_dispatch': batch.quality_grade_at_dispatch,
            'dispatch_timestamp': batch.dispatch_timestamp,
            'distributor_name': str(batch.received_by_distributor) if batch.received_by_distributor else None,
            'weight_at_distributor_kg': batch.weight_at_distributor_kg,
            'distributor_receipt_timestamp': batch.distributor_receipt_timestamp,
            'transit_loss_leg1_pct': batch.transit_loss_leg1_pct,
            'self_transport_loss_pct': batch.self_transport_loss_pct,
            'market_spoilage_loss_pct': batch.market_spoilage_loss_pct,
            'total_loss_pct': batch.total_loss_pct,
            'mismatch_reported': batch.mismatch_reported,
            'timeline': timeline,
            'downstream_orders_count': allocation_summary['order_count'] or 0,
            'downstream_market_agents_count': allocation_summary['market_agent_count'] or 0,
            'downstream_allocated_kg': allocation_summary['total_allocated_kg'],
        })
