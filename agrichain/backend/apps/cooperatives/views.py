from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from django.db.models import F, FloatField, ExpressionWrapper, Avg, Count
from .models import (
    Crop, Cooperative, CooperativeStock, ColdStorageFacility,
    WarehouseManager, WarehouseRentalRequest, WarehouseManagerRating, CooperativeWasteReport,
)
from .serializers import (
    CropSerializer, CooperativeSerializer, CooperativeDirectorySerializer,
    CooperativeStockSerializer, ColdStorageFacilitySerializer,
    WarehouseManagerSerializer, WarehouseRentalRequestSerializer,
    WarehouseManagerRatingSerializer, CooperativeWasteReportSerializer,
)
from apps.authentication.permissions import IsCooperativeManager, IsDistributor, IsAdminRole, IsWarehouseManager
from apps.common.geo import nearest
from apps.notifications.models import Notification
from apps.notifications.services import notify


class CropViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Crop.objects.filter(is_active=True)
    serializer_class = CropSerializer
    permission_classes = [permissions.IsAuthenticated]


class CooperativeViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role in ('ADMIN', 'MINAGRI_OFFICER', 'DISTRIBUTOR', 'TRANSPORTER', 'TRANSPORT_COMPANY'):
            return Cooperative.objects.filter(is_active=True)
        if user.role == 'COOPERATIVE_MANAGER':
            return Cooperative.objects.filter(manager=user)
        return Cooperative.objects.none()

    def get_serializer_class(self):
        if self.action in ('list', 'directory'):
            return CooperativeDirectorySerializer
        return CooperativeSerializer

    @action(detail=False, methods=['get'], permission_classes=[IsCooperativeManager])
    def my(self, request):
        try:
            coop = request.user.cooperative
            return Response(CooperativeSerializer(coop).data)
        except Cooperative.DoesNotExist:
            return Response({'detail': 'No cooperative profile found.'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'], url_path='crop-performance', permission_classes=[IsCooperativeManager])
    def crop_performance(self, request):
        """
        Per-crop performance for the requesting cooperative over the last 90 days, ranked by
        volume actually dispatched — there's no price/revenue field anywhere on the cooperative
        side of the chain, so "best selling" means "what you're actually moving the most of",
        not "what makes the most money". Distributor demand and loss rate ride along as
        supporting context so a manager can see WHY a crop is doing well, not just that it is.
        """
        from apps.traceability.models import Batch
        from apps.distribution.models import ProduceRequest
        from django.db.models import Sum
        from datetime import timedelta

        try:
            coop = request.user.cooperative
        except Cooperative.DoesNotExist:
            return Response({'detail': 'No cooperative profile found.'}, status=status.HTTP_404_NOT_FOUND)

        cutoff = timezone.now() - timedelta(days=90)

        volume_qs = (
            Batch.objects.filter(cooperative=coop, dispatch_timestamp__gte=cutoff)
            .order_by().values('crop_id', 'crop__name')
            .annotate(total_kg=Sum('dispatch_weight_kg'), avg_loss_pct=Avg('total_loss_pct'), batch_count=Count('id'))
        )
        demand_qs = (
            ProduceRequest.objects.filter(
                cooperative=coop, status__in=['ACCEPTED', 'COMPLETED'], created_at__gte=cutoff,
            ).order_by().values('crop_id').annotate(distinct_distributors=Count('distributor', distinct=True))
        )
        demand_by_crop = {row['crop_id']: row['distinct_distributors'] for row in demand_qs}

        crops = [{
            'crop_id': row['crop_id'],
            'crop_name': row['crop__name'],
            'total_kg': float(row['total_kg'] or 0),
            'avg_loss_pct': round(float(row['avg_loss_pct'] or 0), 1),
            'batch_count': row['batch_count'],
            'distinct_distributors': demand_by_crop.get(row['crop_id'], 0),
        } for row in volume_qs]
        crops.sort(key=lambda c: -c['total_kg'])

        return Response({
            'period_days': 90,
            'crops': crops,
            'best_crop': crops[0] if crops else None,
        })

    @action(detail=False, methods=['get'])
    def directory(self, request):
        qs = Cooperative.objects.filter(is_active=True)
        district = request.query_params.get('district')
        crop = request.query_params.get('crop')
        search = request.query_params.get('search')
        if district:
            qs = qs.filter(district__icontains=district)
        if crop:
            qs = qs.filter(crops_specialised__name__icontains=crop)
        if search:
            qs = qs.filter(name__icontains=search)

        if request.query_params.get('nearby') == 'true':
            origin_lat, origin_lng = self._origin_coords(request)
            results = nearest(qs, origin_lat, origin_lng, 'gps_latitude', 'gps_longitude', limit=50)
        else:
            # rank by composite: reliability×0.35 + quality×0.35 + response×0.20 + dispatch×0.10
            qs = qs.annotate(
                composite_score=ExpressionWrapper(
                    F('reliability_score') * 0.35 +
                    F('quality_consistency_rate') * 0.35 +
                    F('response_rate') * 0.20 +
                    F('on_time_dispatch_rate') * 0.10,
                    output_field=FloatField()
                )
            ).order_by('-composite_score', '-total_batches_dispatched')
            results = qs
        serializer = CooperativeDirectorySerializer(
            results, many=True, context={'request': request}
        )
        return Response(serializer.data)

    def _origin_coords(self, request):
        """Origin point for 'nearby' sorting — explicit ?lat=&lng= override, else the
        requesting distributor's warehouse location."""
        lat = request.query_params.get('lat')
        lng = request.query_params.get('lng')
        if lat and lng:
            return float(lat), float(lng)
        user = request.user
        if user.role == 'DISTRIBUTOR':
            try:
                return user.distributor_profile.warehouse_gps_lat, user.distributor_profile.warehouse_gps_lng
            except Exception:
                return None, None
        return None, None

    @action(detail=False, methods=['get'], url_path='my-transporters', url_name='my-transporters', permission_classes=[IsCooperativeManager])
    def my_transporters(self, request):
        try:
            coop = request.user.cooperative
        except Exception:
            return Response({'detail': 'No cooperative profile found.'}, status=status.HTTP_404_NOT_FOUND)
        from apps.transport.models import Transporter
        from apps.transport.serializers import TransporterSerializer
        # Includes suspended (is_active=False) drivers too, so the cooperative can see and
        # reactivate them — otherwise a suspend would look like a permanent, silent delete.
        transporters = Transporter.objects.filter(
            registered_by_cooperative=coop
        ).select_related('user')
        return Response(TransporterSerializer(transporters, many=True).data)


@api_view(['POST'])
@permission_classes([IsCooperativeManager])
def register_own_driver(request):
    """
    A cooperative that owns its own trucks registers a driver directly — not an external
    Transport Company (those self-register via the public Request Access flow and go
    through admin document review), just an employee driving the cooperative's own truck.
    Mirrors the distributor's `register_own_driver` (apps/distribution/views.py) exactly,
    scoped to `registered_by_cooperative` instead of `registered_by_distributor`.
    """
    import secrets, hashlib
    from datetime import timedelta
    from django.utils import timezone
    from django.conf import settings
    from django.core.mail import send_mail
    from apps.authentication.models import User, OTPRecord
    from apps.authentication.serializers import UserCreateSerializer
    from apps.transport.models import Transporter

    try:
        coop = request.user.cooperative
    except Exception:
        return Response({'detail': 'No cooperative profile found.'}, status=status.HTTP_404_NOT_FOUND)

    import re
    from django.db import IntegrityError

    phone = request.data.get('phone_number', '')
    digits = re.sub(r'\D', '', phone)[-8:] or secrets.token_hex(4)
    base_username = request.data.get('username') or f'driver.{digits}'
    # Ensure username is unique by appending a suffix if needed
    username = base_username
    suffix = 1
    from apps.authentication.models import User as _User
    while _User.objects.filter(username=username).exists():
        username = f'{base_username}.{suffix}'
        suffix += 1

    data = {**request.data, 'role': 'TRANSPORTER', 'username': username}
    serializer = UserCreateSerializer(data=data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = serializer.save()
    except IntegrityError as e:
        err = str(e)
        if 'phone_number' in err:
            return Response({'phone_number': ['A user with this phone number already exists.']}, status=status.HTTP_400_BAD_REQUEST)
        if 'email' in err:
            return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'detail': 'Could not create user — a duplicate entry exists.'}, status=status.HTTP_400_BAD_REQUEST)

    operating_districts = request.data.get('operating_districts', [coop.district] if coop.district else ['Kigali'])
    if isinstance(operating_districts, str):
        operating_districts = [d.strip() for d in operating_districts.split(',') if d.strip()]

    Transporter.objects.create(
        user=user,
        operating_districts=operating_districts,
        registered_by_cooperative=coop,
        is_active=True,
    )

    # Send OTP for account activation
    otp_code = ''.join(__import__('random').choices(__import__('string').digits, k=6))
    otp_hash = hashlib.sha256(otp_code.encode()).hexdigest()
    expires_at = timezone.now() + timedelta(hours=getattr(settings, 'OTP_EXPIRY_HOURS', 24))
    OTPRecord.objects.create(
        user=user, otp_code=otp_hash,
        purpose=OTPRecord.Purpose.ACCOUNT_ACTIVATION, expires_at=expires_at,
    )
    if user.email:
        send_mail(
            'ChainSight — Activate Your Account',
            f"Hello {user.get_full_name()},\n\nYou have been registered as a driver on ChainSight by {coop.name}.\n\nYour verification code is: {otp_code}\n\nThis code expires in 24 hours.\n\nChainSight Supply Chain Analytics System",
            settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=True,
        )

    return Response({
        'message': f'Driver {user.get_full_name()} registered. OTP sent to {user.email or user.phone_number}.',
        'user_id': user.id,
        'otp_code': otp_code,  # shown in dev so manager can manually share it
    }, status=status.HTTP_201_CREATED)


class CooperativeStockViewSet(viewsets.ModelViewSet):
    serializer_class = CooperativeStockSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'COOPERATIVE_MANAGER':
            try:
                return CooperativeStock.objects.filter(cooperative=user.cooperative)
            except Cooperative.DoesNotExist:
                return CooperativeStock.objects.none()
        if user.role in ('ADMIN', 'DISTRIBUTOR', 'MINAGRI_OFFICER'):
            coop_id = self.request.query_params.get('cooperative')
            qs = CooperativeStock.objects.filter(is_available=True)
            if coop_id:
                qs = qs.filter(cooperative_id=coop_id)
            return qs
        return CooperativeStock.objects.none()

    def perform_create(self, serializer):
        stock = serializer.save(cooperative=self.request.user.cooperative)
        if stock.is_available:
            self._notify_distributors_stock_available(stock)

    def perform_update(self, serializer):
        was_available = serializer.instance.is_available
        stock = serializer.save()
        if stock.is_available and not was_available:
            self._notify_distributors_stock_available(stock)

    @staticmethod
    def _notify_distributors_stock_available(stock):
        """Stock just became available — notify only distributors this cooperative has
        actually worked with before (i.e. sent at least one produce request), not every
        distributor nationwide. 'Worked with' = any prior ProduceRequest, any status."""
        from apps.distribution.models import Distributor, ProduceRequest
        coop = stock.cooperative
        partner_ids = ProduceRequest.objects.filter(cooperative=coop).values_list(
            'distributor_id', flat=True
        ).distinct()
        for dist in Distributor.objects.filter(id__in=partner_ids, is_active=True).select_related('user'):
            notify(
                dist.user,
                Notification.NotificationType.STOCK_AVAILABLE,
                'New Stock Available',
                f'{coop.name} just listed {stock.quantity_kg}kg of {stock.crop.name} (Grade {stock.quality_grade}) as available.',
                related_object_type='cooperative_stock', related_object_id=stock.id,
            )


class CooperativeWasteReportViewSet(viewsets.ModelViewSet):
    """
    End-of-period report of produce that spoiled before it was ever dispatched — the
    pre-dispatch stage of loss tracking. Mirrors DistributorWasteReportViewSet exactly.
    """
    serializer_class = CooperativeWasteReportSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'COOPERATIVE_MANAGER':
            try:
                return CooperativeWasteReport.objects.filter(cooperative=user.cooperative)
            except Cooperative.DoesNotExist:
                return CooperativeWasteReport.objects.none()
        if user.role in ('ADMIN', 'MINAGRI_OFFICER'):
            return CooperativeWasteReport.objects.all()
        return CooperativeWasteReport.objects.none()

    def perform_create(self, serializer):
        from apps.notifications.services import notify_high_spoilage
        report = serializer.save(cooperative=self.request.user.cooperative)
        notify_high_spoilage(
            'Cooperative', report.cooperative.name, report.storage_spoilage_loss_pct,
            related_object_type='cooperative_waste_report', related_object_id=report.id,
        )

    @action(detail=False, methods=['post'], url_path='create-batch')
    def create_batch(self, request):
        """
        One reporting period, several crop rows submitted together — mirrors
        TransportRequestViewSet.create_multi_stop's shared-fields-plus-list pattern, so a
        cooperative doesn't have to resubmit the whole form once per crop.
        Body: { reporting_period_start, reporting_period_end,
                rows: [{ crop | crop_name, quantity_dispatched_kg, quantity_discarded_kg,
                         discard_reason, discard_notes }, ...] }
        """
        from django.db import transaction

        rows = request.data.get('rows') or []
        if len(rows) < 1:
            return Response({'detail': 'Add at least one crop row.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            coop = request.user.cooperative
        except Cooperative.DoesNotExist:
            return Response({'detail': 'No cooperative profile found.'}, status=status.HTTP_404_NOT_FOUND)

        shared = {k: v for k, v in request.data.items() if k != 'rows'}

        # Validate every row before saving any — a return inside transaction.atomic() commits
        # whatever ran before it (it's not an exception), so partial saves must be prevented
        # by validating everything up front instead of relying on rollback-on-error.
        row_serializers = []
        for i, row in enumerate(rows, start=1):
            serializer = CooperativeWasteReportSerializer(data={**shared, **row})
            if not serializer.is_valid():
                return Response({'row': i, 'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
            row_serializers.append(serializer)

        with transaction.atomic():
            created = [s.save(cooperative=coop) for s in row_serializers]

        from apps.notifications.services import notify_high_spoilage
        for report in created:
            notify_high_spoilage(
                'Cooperative', coop.name, report.storage_spoilage_loss_pct,
                related_object_type='cooperative_waste_report', related_object_id=report.id,
            )

        return Response(CooperativeWasteReportSerializer(created, many=True).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsCooperativeManager])
def manage_transporter(request, pk):
    """Update contact/location details, or suspend/reactivate, a driver registered by
    this cooperative. DELETE is a shorthand for suspending (kept for backward compatibility);
    PATCH with is_active also works and additionally supports reactivation."""
    try:
        coop = request.user.cooperative
    except Exception:
        return Response({'detail': 'No cooperative profile found.'}, status=status.HTTP_404_NOT_FOUND)

    from django.db import IntegrityError
    from apps.transport.models import Transporter
    from apps.transport.serializers import TransporterSerializer

    try:
        transporter = Transporter.objects.get(pk=pk, registered_by_cooperative=coop)
    except Transporter.DoesNotExist:
        return Response({'detail': 'Transporter not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        transporter.is_active = False
        transporter.save(update_fields=['is_active'])
        return Response({'detail': 'Driver suspended.'})

    # PATCH — only allow safe, non-identity fields
    user_fields = {f: request.data[f] for f in ('first_name', 'last_name', 'phone_number', 'email') if f in request.data}
    if user_fields:
        for k, v in user_fields.items():
            setattr(transporter.user, k, v)
        try:
            transporter.user.save(update_fields=list(user_fields.keys()))
        except IntegrityError as e:
            err = str(e)
            if 'phone_number' in err:
                return Response({'phone_number': ['A user with this phone number already exists.']}, status=status.HTTP_400_BAD_REQUEST)
            if 'email' in err:
                return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)
            return Response({'detail': 'Could not update — a duplicate entry exists.'}, status=status.HTTP_400_BAD_REQUEST)

    if 'base_location' in request.data:
        transporter.base_location = request.data['base_location']
    if 'operating_districts' in request.data:
        districts = request.data['operating_districts']
        if isinstance(districts, str):
            districts = [d.strip() for d in districts.split(',') if d.strip()]
        transporter.operating_districts = districts
    if 'is_active' in request.data:
        transporter.is_active = bool(request.data['is_active'])
    transporter.save()
    return Response(TransporterSerializer(transporter).data)


class ColdStorageFacilityViewSet(viewsets.ModelViewSet):
    serializer_class = ColdStorageFacilitySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'COOPERATIVE_MANAGER':
            try:
                return ColdStorageFacility.objects.filter(cooperative=user.cooperative)
            except Cooperative.DoesNotExist:
                return ColdStorageFacility.objects.none()
        if user.role == 'WAREHOUSE_MANAGER':
            try:
                return ColdStorageFacility.objects.filter(warehouse_manager=user.warehouse_manager_profile)
            except WarehouseManager.DoesNotExist:
                return ColdStorageFacility.objects.none()
        if user.role in ('ADMIN', 'MINAGRI_OFFICER'):
            return ColdStorageFacility.objects.filter(is_active=True)
        return ColdStorageFacility.objects.none()

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == 'WAREHOUSE_MANAGER':
            serializer.save(warehouse_manager=user.warehouse_manager_profile)
        elif user.role == 'COOPERATIVE_MANAGER':
            serializer.save(cooperative=user.cooperative)
        else:
            serializer.save()


class WarehouseManagerViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = WarehouseManagerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return WarehouseManager.objects.filter(is_active=True)

    @action(detail=False, methods=['get', 'patch'], permission_classes=[IsWarehouseManager])
    def my(self, request):
        try:
            wm = request.user.warehouse_manager_profile
        except WarehouseManager.DoesNotExist:
            return Response({'detail': 'No warehouse manager profile found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.method == 'PATCH':
            serializer = WarehouseManagerSerializer(wm, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
        return Response(WarehouseManagerSerializer(wm).data)

    @action(detail=False, methods=['get'], url_path='my-ratings', permission_classes=[IsWarehouseManager])
    def my_ratings(self, request):
        try:
            wm = request.user.warehouse_manager_profile
        except WarehouseManager.DoesNotExist:
            return Response({'detail': 'No warehouse manager profile found.'}, status=status.HTTP_404_NOT_FOUND)
        ratings = WarehouseManagerRating.objects.filter(warehouse_manager=wm)
        agg = ratings.aggregate(avg=Avg('rating'), count=Count('id'))
        return Response({
            'average_rating': round(agg['avg'], 2) if agg['avg'] else None,
            'rating_count': agg['count'],
            'recent': WarehouseManagerRatingSerializer(ratings[:20], many=True).data,
        })


class WarehouseDirectoryView(APIView):
    """GET /cooperatives/warehouses/ — facilities available for rent, for cooperatives to browse.
    Default order is by the warehouse manager's average rating (unrated last), so the
    highest-rated facilities are the natural "suggested" ones at the top of the list.
    Add ?nearby=true to sort by distance from the requesting cooperative's location instead."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = ColdStorageFacility.objects.filter(
            is_active=True, is_available_for_rent=True, warehouse_manager__isnull=False,
            cooperative__isnull=True,  # never list a facility that's currently rented out
        ).select_related('warehouse_manager').annotate(
            manager_avg_rating=Avg('warehouse_manager__ratings__rating'),
        ).order_by(F('manager_avg_rating').desc(nulls_last=True), '-created_at')
        district = request.query_params.get('district')
        if district:
            qs = qs.filter(location_description__icontains=district)

        if request.query_params.get('nearby') == 'true':
            origin_lat = request.query_params.get('lat')
            origin_lng = request.query_params.get('lng')
            if origin_lat and origin_lng:
                origin_lat, origin_lng = float(origin_lat), float(origin_lng)
            elif request.user.role == 'COOPERATIVE_MANAGER':
                try:
                    origin_lat, origin_lng = request.user.cooperative.gps_latitude, request.user.cooperative.gps_longitude
                except Exception:
                    origin_lat, origin_lng = None, None
            else:
                origin_lat, origin_lng = None, None
            results = nearest(qs, origin_lat, origin_lng, 'gps_latitude', 'gps_longitude', limit=50)
        else:
            results = qs

        return Response(ColdStorageFacilitySerializer(results, many=True).data)


class WarehouseRentalRequestViewSet(viewsets.ModelViewSet):
    serializer_class = WarehouseRentalRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'COOPERATIVE_MANAGER':
            try:
                return WarehouseRentalRequest.objects.filter(cooperative=user.cooperative)
            except Exception:
                return WarehouseRentalRequest.objects.none()
        if user.role == 'WAREHOUSE_MANAGER':
            try:
                return WarehouseRentalRequest.objects.filter(
                    facility__warehouse_manager=user.warehouse_manager_profile
                )
            except Exception:
                return WarehouseRentalRequest.objects.none()
        if user.role in ('ADMIN', 'MINAGRI_OFFICER'):
            return WarehouseRentalRequest.objects.all()
        return WarehouseRentalRequest.objects.none()

    def perform_create(self, serializer):
        req = serializer.save(cooperative=self.request.user.cooperative)
        if req.facility.warehouse_manager_id:
            notify(
                req.facility.warehouse_manager.user,
                Notification.NotificationType.WAREHOUSE_RENTAL_REQUESTED,
                'New Warehouse Rental Request',
                f'{req.cooperative.name} requested {req.requested_capacity_kg}kg of space in {req.facility.name}.',
                related_object_type='warehouse_rental_request', related_object_id=req.id,
            )

    @action(detail=True, methods=['post'], permission_classes=[IsWarehouseManager])
    def accept(self, request, pk=None):
        rental = self.get_object()
        if rental.status != WarehouseRentalRequest.Status.PENDING:
            return Response({'detail': 'Request is not pending.'}, status=status.HTTP_400_BAD_REQUEST)
        rental.status = WarehouseRentalRequest.Status.ACCEPTED
        rental.responded_at = timezone.now()
        rental.save()
        # Hand the facility to the renting cooperative — every existing IoT/analytics
        # code path keyed on facility.cooperative now scopes correctly automatically.
        facility = rental.facility
        facility.cooperative = rental.cooperative
        facility.is_available_for_rent = False
        facility.save(update_fields=['cooperative', 'is_available_for_rent'])
        notify(
            rental.cooperative.manager,
            Notification.NotificationType.WAREHOUSE_RENTAL_RESPONSE,
            'Warehouse Rental Request Accepted',
            f'{facility.warehouse_manager} accepted your request to rent space in {facility.name}.',
            related_object_type='warehouse_rental_request', related_object_id=rental.id,
        )
        return Response(WarehouseRentalRequestSerializer(rental).data)

    @action(detail=True, methods=['post'], permission_classes=[IsWarehouseManager])
    def decline(self, request, pk=None):
        rental = self.get_object()
        if rental.status != WarehouseRentalRequest.Status.PENDING:
            return Response({'detail': 'Request is not pending.'}, status=status.HTTP_400_BAD_REQUEST)
        rental.status = WarehouseRentalRequest.Status.DECLINED
        rental.decline_reason = request.data.get('reason', '')
        rental.responded_at = timezone.now()
        rental.save()
        notify(
            rental.cooperative.manager,
            Notification.NotificationType.WAREHOUSE_RENTAL_RESPONSE,
            'Warehouse Rental Request Declined',
            f'{rental.facility.warehouse_manager} declined your request for {rental.facility.name}. {rental.decline_reason}'.strip(),
            related_object_type='warehouse_rental_request', related_object_id=rental.id,
        )
        return Response(WarehouseRentalRequestSerializer(rental).data)

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        """Either party can end an active rental — frees the facility for re-listing."""
        rental = self.get_object()
        if rental.status != WarehouseRentalRequest.Status.ACCEPTED:
            return Response({'detail': 'Only an active rental can be ended.'}, status=status.HTTP_400_BAD_REQUEST)
        rental.status = WarehouseRentalRequest.Status.ENDED
        rental.responded_at = timezone.now()
        rental.save()
        facility = rental.facility
        facility.cooperative = None
        facility.is_available_for_rent = True
        facility.save(update_fields=['cooperative', 'is_available_for_rent'])
        return Response(WarehouseRentalRequestSerializer(rental).data)

    @action(detail=True, methods=['post'], permission_classes=[IsCooperativeManager])
    def rate(self, request, pk=None):
        """
        The cooperative that rented rates the Warehouse Manager once the rental has ended —
        one rating per rental request. Mirrors TransportRequestViewSet.rate. Feeds the
        "suggested" ranking on the Rent Warehouse browse page.
        """
        rental = self.get_object()
        try:
            owns_it = rental.cooperative_id == request.user.cooperative.id
        except Exception:
            owns_it = False
        if not owns_it:
            return Response({'detail': 'This rental was not made by you.'}, status=status.HTTP_403_FORBIDDEN)
        if rental.status != WarehouseRentalRequest.Status.ENDED:
            return Response({'detail': 'This rental has not ended yet.'}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(rental, 'rating'):
            return Response({'detail': 'Already rated.'}, status=status.HTTP_400_BAD_REQUEST)

        rating_value = request.data.get('rating')
        try:
            rating_value = int(rating_value)
        except (TypeError, ValueError):
            rating_value = 0
        if not 1 <= rating_value <= 5:
            return Response({'detail': 'Rating must be between 1 and 5.'}, status=status.HTTP_400_BAD_REQUEST)

        rating = WarehouseManagerRating.objects.create(
            rental_request=rental, warehouse_manager=rental.facility.warehouse_manager,
            rated_by_cooperative=rental.cooperative,
            rating=rating_value, comment=request.data.get('comment', ''),
        )
        if rental.facility.warehouse_manager_id:
            notify(
                rental.facility.warehouse_manager.user,
                Notification.NotificationType.WAREHOUSE_RENTAL_RESPONSE,
                'New Rating Received',
                f'You received a {rating_value}-star rating for {rental.facility.name} from {rental.cooperative.name}.',
                related_object_type='warehouse_rental_request', related_object_id=rental.id,
            )
        return Response(WarehouseManagerRatingSerializer(rating).data, status=status.HTTP_201_CREATED)
