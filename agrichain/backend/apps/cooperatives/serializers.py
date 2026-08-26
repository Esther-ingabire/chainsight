from django.db.models import Avg, Count
from rest_framework import serializers
from .models import (
    Crop, Cooperative, CooperativeStock, ColdStorageFacility,
    WarehouseManager, WarehouseRentalRequest, WarehouseManagerRating, CooperativeWasteReport,
)


class CropSerializer(serializers.ModelSerializer):
    class Meta:
        model = Crop
        fields = ['id', 'name', 'category', 'requires_cold_chain',
                  'safe_transit_hours_amber', 'safe_transit_hours_red',
                  'safe_temp_max_amber', 'safe_temp_max_red',
                  'safe_storage_days_amber', 'safe_storage_days_red', 'is_active']


class CooperativeStockSerializer(serializers.ModelSerializer):
    crop_name = serializers.CharField(source='crop.name', read_only=True)

    class Meta:
        model = CooperativeStock
        fields = ['id', 'crop', 'crop_name', 'quantity_kg', 'quality_grade',
                  'harvest_date', 'available_from', 'notes', 'is_available',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def to_internal_value(self, data):
        # Accept a free-text crop name (the "Other" option when the desired crop isn't in the
        # reference list yet) — same get-or-create pattern as ProduceRequestSerializer /
        # CollectionNoticeSerializer in apps.distribution.serializers.
        data = dict(data.lists() if hasattr(data, 'lists') else data.items())
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in data.items()}

        if data.get('crop_name') and not data.get('crop'):
            from apps.distribution.serializers import _resolve_crop
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)

        return super().to_internal_value(data)


class CooperativeWasteReportSerializer(serializers.ModelSerializer):
    crop_name = serializers.CharField(source='crop.name', read_only=True, default=None)

    class Meta:
        model = CooperativeWasteReport
        fields = ['id', 'cooperative', 'crop', 'crop_name', 'reporting_period_start', 'reporting_period_end',
                  'quantity_dispatched_kg', 'quantity_discarded_kg', 'discard_reason', 'discard_notes',
                  'storage_spoilage_loss_pct', 'submitted_at']
        read_only_fields = ['id', 'cooperative', 'storage_spoilage_loss_pct', 'submitted_at']

    def to_internal_value(self, data):
        # Same "Other crop" get-or-create pattern as CooperativeStockSerializer.
        data = dict(data.lists() if hasattr(data, 'lists') else data.items())
        data = {k: (v[0] if isinstance(v, list) and len(v) == 1 else v) for k, v in data.items()}
        if data.get('crop_name') and not data.get('crop'):
            from apps.distribution.serializers import _resolve_crop
            data['crop'] = _resolve_crop(data.pop('crop_name'))
        else:
            data.pop('crop_name', None)
        return super().to_internal_value(data)


class ColdStorageFacilitySerializer(serializers.ModelSerializer):
    cooperative_name = serializers.CharField(source='cooperative.name', read_only=True, default=None)
    warehouse_manager_name = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()
    manager_rating = serializers.SerializerMethodField()
    manager_rating_count = serializers.SerializerMethodField()

    class Meta:
        model = ColdStorageFacility
        fields = ['id', 'cooperative', 'cooperative_name', 'warehouse_manager', 'warehouse_manager_name',
                  'name', 'capacity_kg', 'location_description', 'gps_latitude', 'gps_longitude',
                  'has_iot_sensor', 'sensor_device_id',
                  'is_available_for_rent', 'rental_price_per_month',
                  'temp_threshold_amber_celsius', 'temp_threshold_red_celsius',
                  'humidity_threshold_percent', 'is_active', 'created_at', 'distance_km',
                  'manager_rating', 'manager_rating_count']
        read_only_fields = ['id', 'cooperative', 'warehouse_manager', 'created_at']

    def get_warehouse_manager_name(self, obj):
        return str(obj.warehouse_manager) if obj.warehouse_manager_id else None

    def get_distance_km(self, obj):
        return getattr(obj, 'distance_km', None)

    def validate_is_available_for_rent(self, value):
        # WarehouseRentalRequestViewSet.accept/end flip this in lockstep with `cooperative`
        # to keep a rented-out facility out of the directory — a facility with an active
        # rental (cooperative still set) shouldn't be re-listable by a plain PATCH, or it
        # reappears as bookable while it's still occupied.
        if value and self.instance is not None and self.instance.cooperative_id:
            raise serializers.ValidationError(
                'This facility is currently rented out — it can only be re-listed after the rental ends.'
            )
        return value

    def _rating_agg(self, obj):
        if not obj.warehouse_manager_id:
            return None
        if not hasattr(obj, '_rating_agg_cache'):
            obj._rating_agg_cache = WarehouseManagerRating.objects.filter(
                warehouse_manager_id=obj.warehouse_manager_id
            ).aggregate(avg=Avg('rating'), count=Count('id'))
        return obj._rating_agg_cache

    def get_manager_rating(self, obj):
        agg = self._rating_agg(obj)
        return round(agg['avg'], 1) if agg and agg['avg'] else None

    def get_manager_rating_count(self, obj):
        agg = self._rating_agg(obj)
        return agg['count'] if agg else 0


class WarehouseManagerSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    facilities = ColdStorageFacilitySerializer(many=True, read_only=True)

    class Meta:
        model = WarehouseManager
        fields = ['id', 'user', 'company_name', 'district', 'contact_phone', 'is_active', 'name', 'facilities']
        read_only_fields = ['id', 'user']

    def get_name(self, obj):
        return str(obj)


class WarehouseManagerRatingSerializer(serializers.ModelSerializer):
    cooperative_name = serializers.CharField(source='rated_by_cooperative.name', read_only=True, default=None)

    class Meta:
        model = WarehouseManagerRating
        fields = ['id', 'rental_request', 'warehouse_manager', 'rated_by_cooperative',
                  'cooperative_name', 'rating', 'comment', 'created_at']
        read_only_fields = ['id', 'rental_request', 'warehouse_manager', 'rated_by_cooperative', 'created_at']


class WarehouseRentalRequestSerializer(serializers.ModelSerializer):
    cooperative_name = serializers.CharField(source='cooperative.name', read_only=True)
    facility_name = serializers.CharField(source='facility.name', read_only=True)
    warehouse_manager_name = serializers.SerializerMethodField()
    has_rating = serializers.SerializerMethodField()

    class Meta:
        model = WarehouseRentalRequest
        fields = ['id', 'cooperative', 'cooperative_name', 'facility', 'facility_name',
                  'warehouse_manager_name', 'requested_capacity_kg', 'requires_iot_monitoring', 'notes',
                  'status', 'decline_reason', 'responded_at', 'created_at', 'has_rating']
        read_only_fields = ['id', 'cooperative', 'status', 'decline_reason', 'responded_at', 'created_at']

    def get_warehouse_manager_name(self, obj):
        return str(obj.facility.warehouse_manager) if obj.facility.warehouse_manager_id else None

    def get_has_rating(self, obj):
        return hasattr(obj, 'rating')


class CooperativeSerializer(serializers.ModelSerializer):
    stock_records = CooperativeStockSerializer(many=True, read_only=True)
    storage_facilities = ColdStorageFacilitySerializer(many=True, read_only=True)
    crops_specialised = CropSerializer(many=True, read_only=True)
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Cooperative
        fields = ['id', 'name', 'registration_number', 'district', 'sector',
                  'description', 'gps_latitude', 'gps_longitude', 'crops_specialised',
                  'contact_phone', 'contact_email', 'reliability_score',
                  'on_time_dispatch_rate', 'quality_consistency_rate', 'response_rate',
                  'total_batches_dispatched', 'is_active', 'created_at',
                  'stock_records', 'storage_facilities', 'manager_name']
        read_only_fields = ['id', 'reliability_score', 'on_time_dispatch_rate',
                            'quality_consistency_rate', 'response_rate',
                            'total_batches_dispatched', 'created_at']

    def get_manager_name(self, obj):
        return obj.manager.get_full_name()


class CooperativeDirectorySerializer(serializers.ModelSerializer):
    crops_specialised = serializers.StringRelatedField(many=True)
    manager_name = serializers.SerializerMethodField()
    composite_score = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()

    class Meta:
        model = Cooperative
        fields = ['id', 'name', 'district', 'sector', 'description', 'crops_specialised',
                  'reliability_score', 'on_time_dispatch_rate', 'quality_consistency_rate',
                  'response_rate', 'total_batches_dispatched',
                  'contact_phone', 'contact_email', 'gps_latitude', 'gps_longitude',
                  'manager_name', 'composite_score', 'distance_km']

    def get_distance_km(self, obj):
        return getattr(obj, 'distance_km', None)

    def get_manager_name(self, obj):
        return obj.manager.get_full_name()

    def get_composite_score(self, obj):
        # reliability_score is already the authoritative composite, on a 0–5 star scale
        # (see apps.cooperatives.tasks.recalculate_reliability_scores). Express it as a
        # 0–1 fraction here since the frontend multiplies this by 100 to show a percentage —
        # re-blending it with the 0–100-scale rate fields (as this used to do) produced
        # nonsense figures like several thousand percent.
        return round(float(obj.reliability_score or 0) / 5.0, 2)
