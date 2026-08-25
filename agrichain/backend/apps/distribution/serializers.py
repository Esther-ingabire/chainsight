from rest_framework import serializers
from django.utils import timezone
from .models import Distributor, ProduceRequest, SupplyAgreement, CollectionNotice, Order, DistributorWasteReport


def _resolve_crop(name):
    """Get or create a Crop by name. Returns the crop PK."""
    from apps.cooperatives.models import Crop
    name = str(name).strip()
    try:
        return Crop.objects.get(name__iexact=name).pk
    except Crop.DoesNotExist:
        obj = Crop.objects.create(
            name=name.title(),
            category='DRY_GOODS',
            safe_transit_hours_amber=24,
            safe_transit_hours_red=48,
            safe_storage_days_amber=30,
            safe_storage_days_red=60,
        )
        return obj.pk


class DistributorSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()
    active_notices = serializers.SerializerMethodField()
    contact_person = serializers.SerializerMethodField()
    email = serializers.SerializerMethodField()
    member_since = serializers.DateTimeField(source='created_at', read_only=True)
    linked_agents_count = serializers.SerializerMethodField()

    class Meta:
        model = Distributor
        fields = ['id', 'user', 'company_name', 'description', 'warehouse_location', 'warehouse_gps_lat',
                  'warehouse_gps_lng', 'district', 'contact_phone', 'is_active', 'name',
                  'distance_km', 'active_notices', 'contact_person', 'email', 'member_since',
                  'linked_agents_count']
        read_only_fields = ['id', 'user']

    def get_name(self, obj):
        return str(obj)

    def get_distance_km(self, obj):
        return getattr(obj, 'distance_km', None)

    def get_contact_person(self, obj):
        return obj.user.get_full_name()

    def get_email(self, obj):
        return obj.user.email

    def get_linked_agents_count(self, obj):
        return obj.market_agent_links.filter(is_active=True).count()

    def get_active_notices(self, obj):
        from django.db.models import Q
        from django.utils import timezone
        # No deadline means "open until closed manually" — still active, not excluded.
        notices = obj.collection_notices.filter(
            Q(collection_deadline__isnull=True) | Q(collection_deadline__gte=timezone.now()),
            is_active=True,
        ).select_related('crop')
        return [
            {
                'id': n.id,
                'crop_name': n.crop.name,
                'available_quantity_kg': n.available_quantity_kg,
                'price_per_kg': n.price_per_kg,
                'collection_deadline': n.collection_deadline,
            }
            for n in notices
        ]


class ProduceRequestSerializer(serializers.ModelSerializer):
    cooperative_name = serializers.CharField(source='cooperative.name', read_only=True)
    crop_name = serializers.CharField(source='crop.name', read_only=True)
    distributor_name = serializers.SerializerMethodField()
    supply_agreement_id = serializers.SerializerMethodField()
    delivery_method_display = serializers.CharField(source='get_delivery_method_display', read_only=True)

    class Meta:
        model = ProduceRequest
        fields = ['id', 'distributor', 'distributor_name', 'cooperative', 'cooperative_name',
                  'crop', 'crop_name', 'quantity_kg', 'quality_grade_required',
                  'required_delivery_date', 'additional_notes', 'delivery_method',
                  'delivery_method_display', 'status',
                  'cooperative_response_notes', 'responded_at', 'created_at', 'updated_at',
                  'supply_agreement_id']
        read_only_fields = ['id', 'distributor', 'responded_at', 'created_at', 'updated_at']

    def get_distributor_name(self, obj):
        return str(obj.distributor)

    def get_supply_agreement_id(self, obj):
        return getattr(obj.supply_agreement, 'id', None) if hasattr(obj, 'supply_agreement') else None

    def validate_required_delivery_date(self, value):
        if value < timezone.localdate():
            raise serializers.ValidationError('Required delivery date cannot be in the past.')
        return value

    def to_internal_value(self, data):
        # Mutable copy
        data = dict(data.lists() if hasattr(data, 'lists') else data.items())
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in data.items()}

        # Accept crop by name if crop FK not provided
        if 'crop_name' in data and 'crop' not in data:
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)

        return super().to_internal_value(data)


class SupplyAgreementSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplyAgreement
        fields = ['id', 'produce_request', 'agreed_quantity_kg', 'agreed_quality_grade',
                  'agreed_delivery_date', 'created_at']
        read_only_fields = ['id', 'created_at']


class CollectionNoticeSerializer(serializers.ModelSerializer):
    crop_name = serializers.CharField(source='crop.name', read_only=True)
    distributor_name = serializers.SerializerMethodField()
    orders_count = serializers.SerializerMethodField()

    class Meta:
        model = CollectionNotice
        fields = ['id', 'distributor', 'distributor_name', 'crop', 'crop_name',
                  'available_quantity_kg', 'price_per_kg', 'collection_deadline', 'pickup_location',
                  'pickup_gps_lat', 'pickup_gps_lng', 'notes', 'is_active', 'orders_count',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'distributor', 'created_at', 'updated_at']

    def get_distributor_name(self, obj):
        return str(obj.distributor)

    def get_orders_count(self, obj):
        return obj.orders.count()

    def to_internal_value(self, data):
        data = dict(data.lists() if hasattr(data, 'lists') else data.items())
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in data.items()}

        # crop name → crop FK
        if 'crop_name' in data and 'crop' not in data:
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)

        # Field name aliases from frontend form
        if 'quantity_available_kg' in data and 'available_quantity_kg' not in data:
            data['available_quantity_kg'] = data.pop('quantity_available_kg')
        if 'available_until' in data and 'collection_deadline' not in data:
            # Optional — a blank value means "no deadline", not an invalid date string.
            value = data.pop('available_until')
            data['collection_deadline'] = value or None

        # Drop frontend-only fields not on the model
        for key in ('title', 'available_from'):
            data.pop(key, None)

        return super().to_internal_value(data)


class OrderSerializer(serializers.ModelSerializer):
    market_agent_name = serializers.SerializerMethodField()
    distributor_name = serializers.SerializerMethodField()
    crop_name = serializers.CharField(source='collection_notice.crop.name', read_only=True)
    price_per_kg = serializers.DecimalField(source='collection_notice.price_per_kg', read_only=True,
                                            max_digits=10, decimal_places=2)
    source_batches = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ['id', 'collection_notice', 'market_agent', 'market_agent_name',
                  'distributor', 'distributor_name', 'crop_name', 'price_per_kg',
                  'quantity_requested_kg', 'preferred_collection_date',
                  'confirmed_quantity_kg', 'adjustment_reason',
                  'delivery_method', 'transporter', 'status', 'source_batches',
                  'created_at', 'confirmed_at', 'updated_at']

    def get_source_batches(self, obj):
        # Which cooperative batch(es) this order was actually filled from — see
        # apps.distribution.views._allocate_batches_fifo, set when the distributor confirms.
        return [
            {
                'batch_id': a.batch.batch_id,
                'batch_id_short': str(a.batch.batch_id)[:8].upper(),
                'cooperative_name': a.batch.cooperative.name,
                'quantity_kg': a.quantity_kg,
                'dispatch_timestamp': a.batch.dispatch_timestamp,
            }
            for a in obj.batch_allocations.select_related('batch__cooperative').order_by('created_at')
        ]
        read_only_fields = ['id', 'market_agent', 'distributor', 'confirmed_at', 'created_at', 'updated_at']

    def get_market_agent_name(self, obj):
        return str(obj.market_agent)

    def get_distributor_name(self, obj):
        return str(obj.distributor)


class DistributorWasteReportSerializer(serializers.ModelSerializer):
    crop_name = serializers.CharField(source='crop.name', read_only=True, default=None)

    class Meta:
        model = DistributorWasteReport
        fields = ['id', 'distributor', 'crop', 'crop_name', 'reporting_period_start', 'reporting_period_end',
                  'quantity_moved_kg', 'quantity_discarded_kg', 'discard_reason', 'discard_notes',
                  'warehouse_spoilage_loss_pct', 'submitted_at']
        read_only_fields = ['id', 'distributor', 'warehouse_spoilage_loss_pct', 'submitted_at']

    def to_internal_value(self, data):
        data = dict(data.lists() if hasattr(data, 'lists') else data.items())
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in data.items()}
        if data.get('crop_name') and not data.get('crop'):
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)
        return super().to_internal_value(data)
