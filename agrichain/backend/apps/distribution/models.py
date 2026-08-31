"""
Distribution models: Distributor profiles, ProduceRequests, SupplyAgreements,
CollectionNotices, QuantityRequests (Orders).
"""

from django.db import models
from django.conf import settings


class Distributor(models.Model):
    """
    Wholesale buyer who sources from cooperatives and supplies market agents.
    """

    user              = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                             related_name='distributor_profile',
                                             limit_choices_to={'role': 'DISTRIBUTOR'})
    company_name      = models.CharField(max_length=200, blank=True)
    description       = models.TextField(blank=True, help_text="What this distributor deals in — shown to cooperatives and market agents browsing.")
    warehouse_location = models.CharField(max_length=300)
    warehouse_gps_lat  = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    warehouse_gps_lng  = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    district          = models.CharField(max_length=100)
    contact_phone     = models.CharField(max_length=20)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.company_name or self.user.get_full_name()


class DistributorMarketAgentLink(models.Model):
    """
    Links a Distributor to the Market Agents they supply.
    Market agents can ONLY see collection notices from distributors they are linked to.
    """

    distributor  = models.ForeignKey(Distributor, on_delete=models.CASCADE, related_name='market_agent_links')
    market_agent = models.ForeignKey('market_agents.MarketAgent', on_delete=models.CASCADE, related_name='distributor_links')
    linked_at    = models.DateTimeField(auto_now_add=True)
    is_active    = models.BooleanField(default=True)
    notes        = models.TextField(blank=True)

    class Meta:
        unique_together = ('distributor', 'market_agent')

    def __str__(self):
        return f"{self.distributor} ↔ {self.market_agent}"


class ProduceRequest(models.Model):
    """
    A targeted produce request sent from a Distributor to a specific Cooperative.
    NOT broadcast to all cooperatives — the distributor selects a specific cooperative
    after searching the directory.
    """

    class Status(models.TextChoices):
        PENDING     = 'PENDING',     'Pending Cooperative Response'
        ACCEPTED    = 'ACCEPTED',    'Accepted'
        NEGOTIATING = 'NEGOTIATING', 'Under Negotiation'
        DECLINED    = 'DECLINED',    'Declined'
        COMPLETED   = 'COMPLETED',   'Completed (batch delivered)'
        CANCELLED   = 'CANCELLED',   'Cancelled'

    class QualityGrade(models.TextChoices):
        GRADE_A = 'A', 'Grade A — Premium'
        GRADE_B = 'B', 'Grade B — Standard'
        GRADE_C = 'C', 'Grade C — Any Available'

    class DeliveryMethod(models.TextChoices):
        SELF_COLLECTION      = 'SELF_COLLECTION',      'Distributor Self-Collection'
        TRANSPORTER_DELIVERY = 'TRANSPORTER_DELIVERY',  'Cooperative-Arranged Transporter Delivery'

    distributor    = models.ForeignKey(Distributor, on_delete=models.CASCADE, related_name='produce_requests')
    cooperative    = models.ForeignKey('cooperatives.Cooperative', on_delete=models.PROTECT, related_name='produce_requests_received')
    crop           = models.ForeignKey('cooperatives.Crop', on_delete=models.PROTECT)
    quantity_kg    = models.DecimalField(max_digits=10, decimal_places=2)
    quality_grade_required = models.CharField(max_length=1, choices=QualityGrade.choices)
    required_delivery_date = models.DateField()
    additional_notes = models.TextField(blank=True)

    # Set by the distributor when the request is made — mirrors Order.delivery_method on the
    # downstream (distributor -> market agent) leg, so the cooperative knows upfront whether
    # to expect the distributor's own vehicle or to arrange a TransportRequest themselves.
    delivery_method = models.CharField(
        max_length=25, choices=DeliveryMethod.choices, default=DeliveryMethod.TRANSPORTER_DELIVERY,
    )

    status             = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    cooperative_response_notes = models.TextField(blank=True)
    responded_at       = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Request from {self.distributor} to {self.cooperative} — {self.crop.name} {self.quantity_kg}kg"


class SupplyAgreement(models.Model):
    """
    Created when a Cooperative accepts a ProduceRequest.
    The Supply Agreement is the TRACEABILITY ANCHOR — all batch records reference it.
    """

    produce_request     = models.OneToOneField(ProduceRequest, on_delete=models.PROTECT, related_name='supply_agreement')
    agreed_quantity_kg  = models.DecimalField(max_digits=10, decimal_places=2)
    agreed_quality_grade = models.CharField(max_length=1)
    agreed_delivery_date = models.DateField()
    created_at          = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Agreement #{self.id} — {self.produce_request.cooperative} to {self.produce_request.distributor}"


class CollectionNotice(models.Model):
    """
    A distributor creates a 'Ready for Collection' notice for their linked market agents.
    Market agents can only see notices from distributors they are linked to.
    """

    distributor          = models.ForeignKey(Distributor, on_delete=models.CASCADE, related_name='collection_notices')
    crop                 = models.ForeignKey('cooperatives.Crop', on_delete=models.PROTECT)
    available_quantity_kg = models.DecimalField(max_digits=10, decimal_places=2)
    price_per_kg         = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                               help_text="RWF per kg — lets market agents compare distributors before connecting.")
    collection_deadline  = models.DateTimeField(null=True, blank=True,
                                                help_text="Optional — leave blank to keep the listing open until you close it manually.")
    pickup_location      = models.CharField(max_length=300)
    pickup_gps_lat       = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    pickup_gps_lng       = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    notes                = models.TextField(blank=True)

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Notice: {self.crop.name} {self.available_quantity_kg}kg by {self.distributor}"


class Order(models.Model):
    """
    A confirmed order linking a CollectionNotice to a specific MarketAgent.
    Created after a QuantityRequest is confirmed by the distributor.
    Tracks the delivery method selected for this specific order.
    """

    class Status(models.TextChoices):
        PENDING_CONFIRMATION = 'PENDING_CONFIRMATION', 'Pending Distributor Confirmation'
        CONFIRMED            = 'CONFIRMED',            'Confirmed'
        ADJUSTED             = 'ADJUSTED',             'Quantity Adjusted'
        DECLINED             = 'DECLINED',             'Declined'
        COLLECTED            = 'COLLECTED',            'Produce Collected'
        WASTE_REPORTED       = 'WASTE_REPORTED',       'Waste Report Submitted'
        COMPLETED            = 'COMPLETED',            'Completed'

    class DeliveryMethod(models.TextChoices):
        SELF_COLLECTION          = 'SELF_COLLECTION',          'Agent Self-Collection'
        TRANSPORTER_DELIVERY     = 'TRANSPORTER_DELIVERY',     'Distributor-Arranged Transporter Delivery'

    collection_notice    = models.ForeignKey(CollectionNotice, on_delete=models.PROTECT, related_name='orders')
    market_agent         = models.ForeignKey('market_agents.MarketAgent', on_delete=models.PROTECT, related_name='orders')
    distributor          = models.ForeignKey(Distributor, on_delete=models.PROTECT, related_name='orders')

    # Quantity
    quantity_requested_kg  = models.DecimalField(max_digits=10, decimal_places=2)
    preferred_collection_date = models.DateField(null=True, blank=True)
    confirmed_quantity_kg  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    adjustment_reason      = models.TextField(blank=True)
    notes                  = models.TextField(blank=True, help_text="Set by the market agent when placing the order — e.g. handling instructions.")

    # Delivery method — set by distributor when confirming. preferred_delivery_method is
    # only what the agent asked for at order time (a hint the distributor sees, not binding);
    # keeping it separate from delivery_method preserves the OrderSerializer rule that
    # delivery_method itself is only ever settable via the confirm action.
    preferred_delivery_method = models.CharField(max_length=30, choices=DeliveryMethod.choices, null=True, blank=True)
    delivery_method    = models.CharField(max_length=30, choices=DeliveryMethod.choices, null=True, blank=True)
    transporter        = models.ForeignKey('transport.Transporter', on_delete=models.SET_NULL,
                                           null=True, blank=True, related_name='leg2_orders',
                                           help_text="Only set when delivery_method is TRANSPORTER_DELIVERY")

    status     = models.CharField(max_length=30, choices=Status.choices, default=Status.PENDING_CONFIRMATION)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Order #{self.id} — {self.market_agent} from {self.distributor}"


class DistributorWasteReport(models.Model):
    """
    End-of-period loss report submitted by a distributor for produce that spoiled or was
    discarded while sitting in their own warehouse — the same idea as a Market Agent's
    WasteReport, one stage earlier in the chain (cooperative → distributor → market).
    """

    class DiscardReason(models.TextChoices):
        SPOILAGE  = 'SPOILAGE',  'Spoilage — natural deterioration'
        NO_DEMAND = 'NO_DEMAND', 'No demand — not collected before spoilage'
        DAMAGE    = 'DAMAGE',    'Physical/handling damage in warehouse'
        OTHER     = 'OTHER',     'Other — see notes'

    distributor             = models.ForeignKey(Distributor, on_delete=models.PROTECT, related_name='waste_reports')
    # Nullable for the same reason as CooperativeWasteReport.crop — grandfathers in reports
    # filed before this field existed; the multi-crop-row submission form always sets it now.
    crop                    = models.ForeignKey('cooperatives.Crop', on_delete=models.PROTECT, null=True, blank=True,
                                                 related_name='distributor_waste_reports')
    reporting_period_start  = models.DateField()
    reporting_period_end    = models.DateField()

    quantity_moved_kg       = models.DecimalField(max_digits=10, decimal_places=2,
                                                   help_text="Quantity sold on / collected by market agents during this period")
    quantity_discarded_kg   = models.DecimalField(max_digits=10, decimal_places=2)
    discard_reason          = models.CharField(max_length=20, choices=DiscardReason.choices)
    discard_notes           = models.TextField(blank=True)

    # Warehouse-level loss — calculated by the system: discard / (moved + discarded)
    warehouse_spoilage_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-submitted_at']

    def save(self, *args, **kwargs):
        total = float(self.quantity_moved_kg) + float(self.quantity_discarded_kg)
        self.warehouse_spoilage_loss_pct = round(float(self.quantity_discarded_kg) / total * 100, 2) if total > 0 else 0
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Waste report — {self.distributor} ({self.reporting_period_start} to {self.reporting_period_end})"
