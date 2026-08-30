from rest_framework import serializers
from .models import Batch, BatchAllocation, QRCodeScanEvent


def _batch_downstream_orders(obj):
    """Every order this batch's stock was allocated into, oldest first — this is what
    closes the loop from a 90,000kg cooperative dispatch down to the many small market-
    agent orders it eventually fed. See apps.distribution.views._allocate_batches_fifo."""
    return [
        {
            'order_id': a.order_id,
            'market_agent_name': a.order.market_agent.user.get_full_name() if a.order.market_agent_id else None,
            'quantity_kg': a.quantity_kg,
            'order_status': a.order.status,
            'allocated_at': a.created_at,
        }
        for a in obj.allocations.select_related('order__market_agent__user').order_by('created_at')
    ]


def _batch_ordered_quantity(obj):
    """What the distributor actually agreed to buy — the SupplyAgreement's agreed_quantity_kg,
    set when the cooperative accepted the ProduceRequest. Distinct from dispatch_weight_kg
    (what the cooperative actually sent, which can fall short of the agreement) and
    weight_at_distributor_kg (what arrived, which can fall short of what was sent)."""
    return obj.supply_agreement.agreed_quantity_kg if obj.supply_agreement_id else None


def _batch_destination(obj):
    """
    Where this batch is headed — the linked transport request's destination if one is
    attached yet, else the receiving distributor's warehouse (known as soon as the supply
    agreement exists, even before a transporter is assigned).
    """
    if obj.transport_request_leg2_id and obj.transport_request_leg2:
        return obj.transport_request_leg2.destination
    if obj.transport_request_leg1_id and obj.transport_request_leg1:
        return obj.transport_request_leg1.destination
    dist = getattr(obj.supply_agreement.produce_request, 'distributor', None) if obj.supply_agreement_id else None
    if dist:
        return dist.warehouse_location or dist.district or str(dist)
    return None


class QRCodeScanEventSerializer(serializers.ModelSerializer):
    scanned_by_name = serializers.SerializerMethodField()

    class Meta:
        model = QRCodeScanEvent
        fields = ['id', 'batch', 'scan_point', 'scanned_by', 'scanned_by_name',
                  'gps_latitude', 'gps_longitude', 'scanned_at']
        read_only_fields = ['id', 'scanned_by', 'scanned_at']

    def get_scanned_by_name(self, obj):
        return obj.scanned_by.get_full_name()


class BatchSerializer(serializers.ModelSerializer):
    qr_scans = QRCodeScanEventSerializer(many=True, read_only=True)
    cooperative_name = serializers.CharField(source='cooperative.name', read_only=True)
    crop_name = serializers.CharField(source='crop.name', read_only=True)
    batch_id_short = serializers.SerializerMethodField()
    destination = serializers.SerializerMethodField()
    ordered_quantity_kg = serializers.SerializerMethodField()
    downstream_orders = serializers.SerializerMethodField()

    class Meta:
        model = Batch
        fields = ['id', 'batch_id', 'batch_id_short', 'supply_agreement', 'ordered_quantity_kg',
                  'cooperative', 'cooperative_name', 'crop', 'crop_name',
                  'dispatched_by', 'dispatch_weight_kg', 'quality_grade_at_dispatch',
                  'dispatch_timestamp', 'dispatch_gps_lat', 'dispatch_gps_lng',
                  'transport_request_leg1', 'transport_request_leg2', 'destination',
                  'received_by_distributor', 'weight_at_distributor_kg',
                  'quality_at_distributor', 'distributor_receipt_timestamp',
                  'order', 'downstream_orders', 'current_status',
                  'transit_loss_leg1_kg', 'transit_loss_leg1_pct',
                  'self_transport_loss_kg', 'self_transport_loss_pct',
                  'market_spoilage_loss_kg', 'market_spoilage_loss_pct',
                  'total_loss_kg', 'total_loss_pct',
                  'mismatch_reported', 'mismatch_reported_at', 'mismatch_description', 'mismatch_notes',
                  'created_at', 'updated_at', 'qr_scans']
        read_only_fields = ['id', 'batch_id', 'dispatched_by', 'cooperative', 'created_at', 'updated_at',
                            'transit_loss_leg1_kg', 'transit_loss_leg1_pct',
                            'self_transport_loss_kg', 'self_transport_loss_pct',
                            'market_spoilage_loss_kg', 'market_spoilage_loss_pct',
                            'total_loss_kg', 'total_loss_pct',
                            'mismatch_reported', 'mismatch_reported_at', 'mismatch_description', 'mismatch_notes',
                            # Only ever set by confirm-receipt (direct model writes) — a plain
                            # PATCH shouldn't be able to fabricate a distributor receipt and
                            # zero out recorded transit loss without going through it.
                            'current_status', 'received_by_distributor', 'weight_at_distributor_kg',
                            'quality_at_distributor', 'distributor_receipt_timestamp']

    def get_batch_id_short(self, obj):
        return str(obj.batch_id)[:8].upper()

    def get_destination(self, obj):
        return _batch_destination(obj)

    def get_ordered_quantity_kg(self, obj):
        return _batch_ordered_quantity(obj)

    def get_downstream_orders(self, obj):
        return _batch_downstream_orders(obj)


class BatchListSerializer(serializers.ModelSerializer):
    cooperative_name = serializers.CharField(source='cooperative.name', read_only=True)
    crop_name = serializers.CharField(source='crop.name', read_only=True)
    batch_id_short = serializers.SerializerMethodField()
    destination = serializers.SerializerMethodField()
    ordered_quantity_kg = serializers.SerializerMethodField()
    delivery_method = serializers.SerializerMethodField()

    class Meta:
        model = Batch
        fields = [
            'id', 'batch_id', 'batch_id_short', 'cooperative_name', 'crop_name',
            'ordered_quantity_kg', 'dispatch_weight_kg', 'quality_grade_at_dispatch',
            'current_status', 'dispatch_timestamp',
            'weight_at_distributor_kg', 'quality_at_distributor',
            'distributor_receipt_timestamp',
            'transit_loss_leg1_pct', 'total_loss_pct',
            'transport_request_leg1', 'transport_request_leg2', 'destination',
            'mismatch_reported', 'mismatch_description', 'delivery_method',
        ]

    def get_batch_id_short(self, obj):
        return str(obj.batch_id)[:8].upper()

    def get_destination(self, obj):
        return _batch_destination(obj)

    def get_ordered_quantity_kg(self, obj):
        return _batch_ordered_quantity(obj)

    def get_delivery_method(self, obj):
        # How this batch left the cooperative (leg 1) — set by the distributor on the
        # ProduceRequest, not to be confused with Order.delivery_method (leg 2, distributor
        # to market agent).
        if obj.supply_agreement_id:
            return obj.supply_agreement.produce_request.delivery_method
        return None
