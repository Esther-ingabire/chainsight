from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from django.db.models import Avg, Sum, Q
import datetime

from .models import MarketAgent, CollectionConfirmation, WasteReport, MarketPriceRecord
from .serializers import (
    MarketAgentSerializer, CollectionConfirmationSerializer,
    WasteReportSerializer, CollectionNoticeForAgentSerializer,
    MarketPriceRecordSerializer,
)
from apps.authentication.permissions import IsMarketAgent
from apps.notifications.models import Notification
from apps.notifications.services import notify


class MarketAgentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MarketAgentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'MARKET_AGENT':
            return MarketAgent.objects.filter(user=user)
        if user.role in ('ADMIN', 'MINAGRI_OFFICER', 'DISTRIBUTOR'):
            return MarketAgent.objects.filter(is_active=True)
        return MarketAgent.objects.none()

    @action(detail=False, methods=['get', 'patch'], permission_classes=[IsMarketAgent])
    def my(self, request):
        try:
            agent = request.user.market_agent_profile
        except MarketAgent.DoesNotExist:
            return Response({'detail': 'No market agent profile found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.method == 'PATCH':
            serializer = MarketAgentSerializer(agent, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
        return Response(MarketAgentSerializer(agent).data)

    @action(detail=False, methods=['get'], url_path='my-analytics', url_name='my-analytics',
            permission_classes=[IsMarketAgent])
    def my_analytics(self, request):
        try:
            agent = request.user.market_agent_profile
        except MarketAgent.DoesNotExist:
            return Response({'detail': 'No profile.'}, status=status.HTTP_404_NOT_FOUND)

        from apps.distribution.models import CollectionNotice
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        active_notices = CollectionNotice.objects.filter(
            Q(collection_deadline__isnull=True) | Q(collection_deadline__gte=now),
            is_active=True,
        ).count()
        collections_month = CollectionConfirmation.objects.filter(
            market_agent=agent, created_at__gte=month_start
        ).count()

        # Collection loss: avg self_transport_loss_pct over last 30 days
        thirty_ago = now - datetime.timedelta(days=30)
        collection_loss = CollectionConfirmation.objects.filter(
            market_agent=agent,
            created_at__gte=thirty_ago,
            self_transport_loss_pct__isnull=False,
        ).aggregate(avg=Avg('self_transport_loss_pct'))['avg'] or 0

        # Waste rate: total discarded / (sold + discarded) over last 30 days
        waste_qs = WasteReport.objects.filter(market_agent=agent, submitted_at__gte=thirty_ago)
        totals = waste_qs.aggregate(
            sold=Sum('quantity_sold_kg'),
            discarded=Sum('quantity_discarded_kg'),
        )
        sold = float(totals['sold'] or 0)
        discarded = float(totals['discarded'] or 0)
        waste_rate = round((discarded / (sold + discarded)) * 100, 1) if (sold + discarded) > 0 else 0

        return Response({
            'active_notices': active_notices,
            'collection_loss_pct': round(float(collection_loss), 1),
            'waste_rate_pct': waste_rate,
            'collections_this_month': collections_month,
        })


class CollectionConfirmationViewSet(viewsets.ModelViewSet):
    serializer_class = CollectionConfirmationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'MARKET_AGENT':
            try:
                return CollectionConfirmation.objects.filter(market_agent=user.market_agent_profile)
            except MarketAgent.DoesNotExist:
                return CollectionConfirmation.objects.none()
        if user.role == 'DISTRIBUTOR':
            # Was previously `.all()` — leaked every other distributor's confirmations too.
            # A distributor should only see confirmations for produce THEY dispatched.
            try:
                return CollectionConfirmation.objects.filter(order__distributor=user.distributor_profile)
            except Exception:
                return CollectionConfirmation.objects.none()
        if user.role in ('ADMIN', 'MINAGRI_OFFICER'):
            return CollectionConfirmation.objects.all()
        return CollectionConfirmation.objects.none()

    def perform_create(self, serializer):
        from apps.distribution.models import Order
        confirmation = serializer.save(market_agent=self.request.user.market_agent_profile)
        order = confirmation.order
        if order.status == Order.Status.CONFIRMED:
            order.status = Order.Status.COLLECTED
            order.save(update_fields=['status', 'updated_at'])
        notify(
            confirmation.order.distributor.user,
            Notification.NotificationType.AGENT_COLLECTION_CONFIRMED,
            'Market Agent Collected Produce',
            f'{confirmation.market_agent} collected {confirmation.quantity_collected_kg}kg for Order #{confirmation.order_id}.',
            related_object_type='collection_confirmation', related_object_id=confirmation.id,
        )


class WasteReportViewSet(viewsets.ModelViewSet):
    serializer_class = WasteReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'MARKET_AGENT':
            try:
                return WasteReport.objects.filter(market_agent=user.market_agent_profile)
            except MarketAgent.DoesNotExist:
                return WasteReport.objects.none()
        if user.role in ('ADMIN', 'DISTRIBUTOR', 'MINAGRI_OFFICER'):
            return WasteReport.objects.all()
        return WasteReport.objects.none()

    def perform_create(self, serializer):
        from apps.distribution.models import Order
        from apps.notifications.services import notify_high_spoilage
        report = serializer.save(market_agent=self.request.user.market_agent_profile)
        if report.order_id and report.order.status in (Order.Status.CONFIRMED, Order.Status.COLLECTED):
            report.order.status = Order.Status.WASTE_REPORTED
            report.order.save(update_fields=['status', 'updated_at'])
        notify_high_spoilage(
            'Market Agent', str(report.market_agent), report.market_spoilage_loss_pct,
            related_object_type='market_agent_waste_report', related_object_id=report.id,
        )

    @action(detail=False, methods=['post'], url_path='create-batch')
    def create_batch(self, request):
        """
        One reporting period, several crop rows submitted together — same pattern as
        CooperativeWasteReportViewSet.create_batch / DistributorWasteReportViewSet.create_batch.
        Each row still gets its own idempotency_key (auto-generated by the serializer if not
        supplied), so offline-queue dedup keeps working per row.
        Body: { reporting_period_start, reporting_period_end,
                rows: [{ crop | crop_name, quantity_sold_kg, quantity_discarded_kg,
                         discard_reason, discard_notes, order? }, ...] }
        """
        from django.db import transaction

        rows = request.data.get('rows') or []
        if len(rows) < 1:
            return Response({'detail': 'Add at least one crop row.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            agent = request.user.market_agent_profile
        except MarketAgent.DoesNotExist:
            return Response({'detail': 'No market agent profile found.'}, status=status.HTTP_404_NOT_FOUND)

        shared = {k: v for k, v in request.data.items() if k != 'rows'}

        row_serializers = []
        for i, row in enumerate(rows, start=1):
            serializer = WasteReportSerializer(data={**shared, **row})
            if not serializer.is_valid():
                return Response({'row': i, 'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
            row_serializers.append(serializer)

        from apps.distribution.models import Order

        with transaction.atomic():
            created = [s.save(market_agent=agent) for s in row_serializers]
            for report in created:
                if report.order_id and report.order.status in (Order.Status.CONFIRMED, Order.Status.COLLECTED):
                    report.order.status = Order.Status.WASTE_REPORTED
                    report.order.save(update_fields=['status', 'updated_at'])

        from apps.notifications.services import notify_high_spoilage
        for report in created:
            notify_high_spoilage(
                'Market Agent', str(agent), report.market_spoilage_loss_pct,
                related_object_type='market_agent_waste_report', related_object_id=report.id,
            )

        return Response(WasteReportSerializer(created, many=True).data, status=status.HTTP_201_CREATED)


class AvailableNoticesView(APIView):
    """Active collection notices visible to market agents, with risk assessment."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.distribution.models import CollectionNotice
        now = timezone.now()
        notices = CollectionNotice.objects.filter(
            Q(collection_deadline__isnull=True) | Q(collection_deadline__gte=now),
            is_active=True,
        ).select_related('distributor__user', 'crop')

        min_price = request.query_params.get('min_price')
        max_price = request.query_params.get('max_price')
        if min_price:
            notices = notices.filter(price_per_kg__gte=min_price)
        if max_price:
            notices = notices.filter(price_per_kg__lte=max_price)

        sort = request.query_params.get('sort')
        if sort == 'price_asc':
            notices = notices.order_by('price_per_kg', 'collection_deadline')
        elif sort == 'price_desc':
            notices = notices.order_by('-price_per_kg', 'collection_deadline')
        else:
            notices = notices.order_by('collection_deadline')

        serializer = CollectionNoticeForAgentSerializer(notices, many=True, context={'now': now})
        return Response(serializer.data)


class MarketPriceRecordViewSet(viewsets.ModelViewSet):
    """
    Market agents submit price observations (PriceRecording, mobile); every authenticated
    role can browse the resulting national feed (MarketPrices, distributor-facing) — this
    is a shared price board, not agent-private data, so only the write side is restricted.
    """
    serializer_class = MarketPriceRecordSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'MARKET_AGENT':
            try:
                return MarketPriceRecord.objects.filter(market_agent=user.market_agent_profile)
            except MarketAgent.DoesNotExist:
                return MarketPriceRecord.objects.none()
        return MarketPriceRecord.objects.all()

    def perform_create(self, serializer):
        try:
            agent = self.request.user.market_agent_profile
        except MarketAgent.DoesNotExist:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'Market agent profile not found.'})
        serializer.save(market_agent=agent)

    def perform_update(self, serializer):
        if serializer.instance.market_agent.user_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('You can only edit your own price records.')
        serializer.save()

    def perform_destroy(self, instance):
        if instance.market_agent.user_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('You can only delete your own price records.')
        instance.delete()

    @action(detail=False, methods=['get'], url_path='national')
    def national(self, request):
        """
        Latest observation per (crop, market) pair nationwide, each paired with the prior
        observation for that same combination — this is what the distributor-facing Market
        Prices board actually shows (today's price + % change), not a raw firehose of every
        submission ever made.
        """
        from django.db.models import Max

        latest_ts = (
            MarketPriceRecord.objects.values('crop_id', 'market_name')
            .annotate(latest=Max('recorded_at'))
        )
        # Build a queryset matching each (crop, market)'s single most-recent row without an
        # N-query loop: OR together one exact-match filter per group.
        from django.db.models import Q
        combined = Q(pk__in=[])
        for row in latest_ts:
            combined |= Q(crop_id=row['crop_id'], market_name=row['market_name'], recorded_at=row['latest'])
        latest_records = MarketPriceRecord.objects.filter(combined).select_related('crop', 'market_agent__user') if latest_ts else MarketPriceRecord.objects.none()

        search = request.query_params.get('search', '').strip().lower()
        if search:
            latest_records = [
                r for r in latest_records
                if search in r.crop.name.lower() or search in r.market_name.lower()
            ]

        serializer = MarketPriceRecordSerializer(latest_records, many=True)
        return Response(serializer.data)
