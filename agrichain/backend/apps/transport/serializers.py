from rest_framework import serializers
from django.utils import timezone
from .models import Transporter, Vehicle, TransportRequest, Trip, GPSTrack, IncidentReport, TransporterRating


class VehicleSerializer(serializers.ModelSerializer):
    # True when this vehicle has a trip that has been picked up but not yet delivered —
    # used by the dispatch UI to grey-out trucks that are currently on the road.
    is_busy = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = ['id', 'vehicle_type', 'plate_number', 'capacity_kg',
                  'operating_districts', 'has_iot_temperature', 'iot_device_id', 'is_active',
                  'is_busy']
        read_only_fields = ['id', 'is_busy']

    def get_is_busy(self, obj):
        return obj.transport_requests.filter(
            trip__pickup_confirmed_at__isnull=False,
            trip__delivery_confirmed_at__isnull=True,
        ).exists()


class TransporterSerializer(serializers.ModelSerializer):
    vehicles = VehicleSerializer(many=True, read_only=True)
    name = serializers.SerializerMethodField()
    phone_number = serializers.CharField(source='user.phone_number', read_only=True)
    email = serializers.CharField(source='user.email', read_only=True)

    class Meta:
        model = Transporter
        fields = ['id', 'user', 'company_name', 'description', 'base_location', 'operating_districts',
                  'is_active', 'vehicles', 'name', 'phone_number', 'email', 'parent_company']
        read_only_fields = ['id', 'user']

    def get_name(self, obj):
        return str(obj)


class DriverSerializer(TransporterSerializer):
    """A Transporter that is a driver registered under a Transport Company account."""
    has_active_trip = serializers.SerializerMethodField()
    has_logged_in = serializers.SerializerMethodField()

    class Meta(TransporterSerializer.Meta):
        fields = TransporterSerializer.Meta.fields + ['has_active_trip', 'has_logged_in']

    def get_has_active_trip(self, obj):
        return obj.transport_requests.filter(status__in=['ACCEPTED', 'IN_PROGRESS']).exists()

    def get_has_logged_in(self, obj):
        return obj.user.last_login is not None


class IncidentReportSerializer(serializers.ModelSerializer):
    incident_type_display = serializers.CharField(source='get_incident_type_display', read_only=True)

    class Meta:
        model = IncidentReport
        fields = ['id', 'trip', 'incident_type', 'incident_type_display', 'description',
                  'gps_lat', 'gps_lng', 'resolved', 'reported_at']
        read_only_fields = ['id', 'reported_at']


class TransporterRatingSerializer(serializers.ModelSerializer):
    rated_by = serializers.SerializerMethodField()
    driver_name = serializers.CharField(source='transporter.__str__', read_only=True)
    route = serializers.SerializerMethodField()

    class Meta:
        model = TransporterRating
        fields = ['id', 'transport_request', 'rating', 'comment', 'rated_by', 'driver_name', 'route', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_rated_by(self, obj):
        if obj.rated_by_cooperative:
            return obj.rated_by_cooperative.name
        if obj.rated_by_distributor:
            return obj.rated_by_distributor.company_name or str(obj.rated_by_distributor)
        return 'Unknown'

    def get_route(self, obj):
        req = obj.transport_request
        return f'{req.pickup_location} → {req.destination}'


class GPSTrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = GPSTrack
        fields = ['id', 'trip', 'latitude', 'longitude', 'speed_kmh', 'timestamp']
        read_only_fields = ['id']


class TripSerializer(serializers.ModelSerializer):
    gps_tracks = GPSTrackSerializer(many=True, read_only=True)
    transit_duration_hours = serializers.FloatField(read_only=True)
    condition_on_arrival_display = serializers.CharField(source='get_condition_on_arrival_display', read_only=True, default=None)

    class Meta:
        model = Trip
        fields = ['id', 'transport_request', 'actual_pickup_datetime',
                  'actual_delivery_datetime', 'pickup_confirmed_at',
                  'delivery_confirmed_at', 'delivery_notes', 'created_at',
                  'recipient_name', 'condition_on_arrival', 'condition_on_arrival_display',
                  'delivery_gps_lat', 'delivery_gps_lng', 'delivery_photo',
                  'gps_tracks', 'transit_duration_hours']
        read_only_fields = ['id', 'created_at']


class TripListSerializer(serializers.ModelSerializer):
    """Flat serializer for trip list — includes denormalized route/cargo from transport_request."""
    pickup_location          = serializers.CharField(source='transport_request.pickup_location', read_only=True)
    destination              = serializers.CharField(source='transport_request.destination', read_only=True)
    cargo_description        = serializers.CharField(source='transport_request.cargo_description', read_only=True)
    estimated_cargo_weight_kg = serializers.DecimalField(
        source='transport_request.estimated_cargo_weight_kg', max_digits=10, decimal_places=2, read_only=True
    )
    requires_refrigeration   = serializers.BooleanField(source='transport_request.requires_refrigeration', read_only=True)
    transit_duration_hours   = serializers.FloatField(read_only=True)

    class Meta:
        model = Trip
        fields = [
            'id', 'actual_pickup_datetime', 'actual_delivery_datetime',
            'delivery_confirmed_at', 'transit_duration_hours',
            'pickup_location', 'destination', 'cargo_description',
            'estimated_cargo_weight_kg', 'requires_refrigeration',
        ]


class TransportRequestSerializer(serializers.ModelSerializer):
    trip = TripSerializer(read_only=True)
    transporter_name = serializers.CharField(source='transporter.__str__', read_only=True)
    vehicle_plate = serializers.CharField(source='vehicle.plate_number', read_only=True)
    requester_type = serializers.SerializerMethodField()
    requester_name = serializers.SerializerMethodField()
    has_rating = serializers.SerializerMethodField()

    class Meta:
        model = TransportRequest
        fields = ['id', 'requested_by_cooperative', 'requested_by_distributor',
                  'transporter', 'transporter_name', 'vehicle', 'vehicle_plate',
                  'requester_type', 'requester_name',
                  'leg_number', 'pickup_location', 'pickup_gps_lat', 'pickup_gps_lng',
                  'destination', 'destination_gps_lat', 'destination_gps_lng',
                  'cargo_description', 'estimated_cargo_weight_kg',
                  'requires_refrigeration', 'required_pickup_datetime',
                  'status', 'decline_reason', 'accepted_at', 'notes',
                  'run_id', 'stop_sequence', 'has_rating',
                  'created_at', 'updated_at', 'trip']
        read_only_fields = ['id', 'accepted_at', 'created_at', 'updated_at']

    def get_has_rating(self, obj):
        return hasattr(obj, 'rating')

    def get_requester_type(self, obj):
        if obj.requested_by_cooperative_id:
            return 'Cooperative'
        if obj.requested_by_distributor_id:
            return 'Distributor'
        return 'Unknown'

    def get_requester_name(self, obj):
        if obj.requested_by_cooperative:
            return obj.requested_by_cooperative.name
        if obj.requested_by_distributor:
            return str(obj.requested_by_distributor)
        return '—'

    def validate_required_pickup_datetime(self, value):
        if value < timezone.now():
            raise serializers.ValidationError('Required pickup date/time cannot be in the past.')
        return value
