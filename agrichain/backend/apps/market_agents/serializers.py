import uuid
from rest_framework import serializers
from .models import MarketAgent, CollectionConfirmation, WasteReport, MarketPriceRecord


class MarketAgentSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = MarketAgent
        fields = ['id', 'user', 'stall_number', 'market_name', 'market_district',
                  'gps_latitude', 'gps_longitude', 'is_active', 'created_at', 'name']
        read_only_fields = ['id', 'user', 'created_at']

    def get_name(self, obj):
        return str(obj)


class CollectionConfirmationSerializer(serializers.ModelSerializer):
    # Accept a list of condition codes from the UI; store first as condition_code, rest in notes
    condition_codes = serializers.ListField(
        child=serializers.ChoiceField(choices=CollectionConfirmation.ConditionCode.choices),
        write_only=True, required=False, default=list,
    )
    market_agent_name  = serializers.SerializerMethodField()
    crop_name          = serializers.SerializerMethodField()
    condition_display  = serializers.CharField(source='get_condition_code_display', read_only=True, default=None)

    class Meta:
        model = CollectionConfirmation
        fields = [
            'id', 'order', 'market_agent', 'market_agent_name', 'crop_name',
            'quantity_collected_kg', 'collected_at', 'step1_idempotency_key',
            'quantity_arrived_at_stall_kg', 'condition_code', 'condition_codes', 'condition_display',
            'condition_notes', 'arrived_at', 'step2_idempotency_key',
            'self_transport_loss_kg', 'self_transport_loss_pct',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'market_agent', 'self_transport_loss_kg',
            'self_transport_loss_pct', 'created_at', 'updated_at',
        ]

    def get_market_agent_name(self, obj):
        return str(obj.market_agent)

    def get_crop_name(self, obj):
        try:
            return obj.order.collection_notice.crop.name
        except Exception:
            return None

    def to_internal_value(self, data):
        # Auto-generate idempotency keys if not supplied by client
        data = data.copy() if hasattr(data, 'copy') else dict(data)
        if not data.get('step1_idempotency_key'):
            data['step1_idempotency_key'] = str(uuid.uuid4())
        if data.get('quantity_arrived_at_stall_kg') and not data.get('step2_idempotency_key'):
            data['step2_idempotency_key'] = str(uuid.uuid4())
        return super().to_internal_value(data)

    def create(self, validated_data):
        codes = validated_data.pop('condition_codes', [])
        if codes:
            validated_data['condition_code'] = codes[0]
            extras = codes[1:]
            if extras:
                existing = validated_data.get('condition_notes', '')
                validated_data['condition_notes'] = (
                    (existing + ' | ' if existing else '') + ' | '.join(extras)
                )
        instance = super().create(validated_data)
        instance.calculate_self_transport_loss()
        instance.save()
        return instance

    def update(self, instance, validated_data):
        codes = validated_data.pop('condition_codes', [])
        if codes:
            validated_data['condition_code'] = codes[0]
        instance = super().update(instance, validated_data)
        instance.calculate_self_transport_loss()
        instance.save()
        return instance


class WasteReportSerializer(serializers.ModelSerializer):
    crop_name = serializers.CharField(source='crop.name', read_only=True, default=None)

    class Meta:
        model = WasteReport
        fields = [
            'id', 'market_agent', 'order', 'crop', 'crop_name',
            'reporting_period_start', 'reporting_period_end',
            'quantity_sold_kg', 'quantity_discarded_kg',
            'discard_reason', 'discard_notes',
            'market_spoilage_loss_pct', 'submitted_at', 'idempotency_key',
        ]
        read_only_fields = ['id', 'market_agent', 'market_spoilage_loss_pct', 'submitted_at']

    def to_internal_value(self, data):
        data = data.copy() if hasattr(data, 'copy') else dict(data)
        if not data.get('idempotency_key'):
            data['idempotency_key'] = str(uuid.uuid4())
        if data.get('crop_name') and not data.get('crop'):
            from apps.distribution.serializers import _resolve_crop
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)
        return super().to_internal_value(data)

    def create(self, validated_data):
        instance = super().create(validated_data)
        instance.calculate_spoilage_loss()
        instance.save()
        return instance


class CollectionNoticeForAgentSerializer(serializers.Serializer):
    """Read-only projection of CollectionNotice with risk assessment."""
    id = serializers.IntegerField()
    crop_name = serializers.SerializerMethodField()
    available_quantity_kg = serializers.DecimalField(max_digits=10, decimal_places=2)
    price_per_kg = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    collection_deadline = serializers.DateTimeField(allow_null=True)
    pickup_location = serializers.CharField()
    distributor_name = serializers.SerializerMethodField()
    risk_level = serializers.SerializerMethodField()
    risk_label = serializers.SerializerMethodField()

    def get_crop_name(self, obj):
        return obj.crop.name if obj.crop else ''

    def get_distributor_name(self, obj):
        try:
            return obj.distributor.user.get_full_name() or obj.distributor.company_name
        except Exception:
            return ''

    def _hours_left(self, obj):
        if obj.collection_deadline is None:
            return float('inf')  # no deadline set — never urgent
        now = self.context.get('now') or __import__('django.utils.timezone', fromlist=['timezone']).timezone.now()
        delta = obj.collection_deadline - now
        return delta.total_seconds() / 3600

    def get_risk_level(self, obj):
        hours = self._hours_left(obj)
        crop = obj.crop
        if crop:
            amber_h = float(crop.safe_transit_hours_amber or 999)
            red_h   = float(crop.safe_transit_hours_red or 999)
            # In the notice context hours_left is REMAINING time, so:
            # < amber_h  → HIGH (so little time even self-transport risks spoilage)
            # amber_h to red_h → AMBER (moderate urgency, consider transporter)
            # >= red_h → LOW (plenty of time)
            if hours < amber_h:
                return 'HIGH'
            if hours < red_h:
                return 'AMBER'
        return 'LOW'

    def get_risk_label(self, obj):
        level = self.get_risk_level(obj)
        return {
            'LOW': 'Low Risk — Safe to self-collect',
            'AMBER': 'Amber Risk — Consider using a transporter',
            'HIGH': 'High Risk — Use a transporter',
        }[level]


class MarketPriceRecordSerializer(serializers.ModelSerializer):
    crop_name = serializers.CharField(source='crop.name', read_only=True)
    market_agent_name = serializers.SerializerMethodField()
    prev_price = serializers.SerializerMethodField()

    class Meta:
        model = MarketPriceRecord
        fields = ['id', 'crop', 'crop_name', 'market_name', 'price_per_kg', 'quality_grade',
                  'notes', 'recorded_at', 'market_agent_name', 'prev_price']
        read_only_fields = ['id', 'recorded_at']

    def get_market_agent_name(self, obj):
        return str(obj.market_agent)

    def get_prev_price(self, obj):
        # The most recent OTHER observation for this exact crop+market, so the frontend
        # can show a real %-change instead of a fabricated one.
        prev = MarketPriceRecord.objects.filter(
            crop_id=obj.crop_id, market_name=obj.market_name, recorded_at__lt=obj.recorded_at,
        ).order_by('-recorded_at').first()
        return prev.price_per_kg if prev else None

    def validate_price_per_kg(self, value):
        if value <= 0:
            raise serializers.ValidationError('Price must be greater than zero.')
        return value

    def to_internal_value(self, data):
        data = data.copy() if hasattr(data, 'copy') else dict(data)
        if data.get('crop_name') and not data.get('crop'):
            from apps.distribution.serializers import _resolve_crop
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)
        return super().to_internal_value(data)
