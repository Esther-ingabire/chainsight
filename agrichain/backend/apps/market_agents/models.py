"""
Market Agent models: MarketAgent profiles, CollectionConfirmations, WasteReports.
These are the field-role models — all forms are offline-capable with idempotency keys.
"""

from django.db import models
from django.conf import settings


class MarketAgent(models.Model):
    """
    A registered vendor at an organised market.
    Primary interface: React Native mobile app (offline-capable).
    """

    user         = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                        related_name='market_agent_profile',
                                        limit_choices_to={'role': 'MARKET_AGENT'})
    stall_number = models.CharField(max_length=50)
    market_name  = models.CharField(max_length=200)
    market_district = models.CharField(max_length=100)
    gps_latitude    = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    gps_longitude   = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['market_name', 'stall_number']

    def __str__(self):
        return f"{self.user.get_full_name()} — Stall {self.stall_number}, {self.market_name}"


class CollectionConfirmation(models.Model):
    """
    Two-step confirmation by a market agent.

    STEP 1 — At Distributor:
        Recorded when the agent arrives at the distributor's warehouse.
        Records quantity collected and QR code scan.

    STEP 2 — At Stall (optional):
        Recorded when the agent returns to their market stall.
        Records arrived quantity and condition-on-arrival code.
        Self-transport loss = step1.quantity_collected - step2.quantity_arrived (if step2 provided).
        If step2 is not submitted, self-transport loss defaults to 0 (conservative default).

    Both steps use idempotency_key to prevent duplicate submissions from offline queue.
    """

    class ConditionCode(models.TextChoices):
        HEAT_DAMAGE        = 'HEAT_DAMAGE',        'Heat damage — degraded due to heat exposure during trip'
        PHYSICAL_DAMAGE    = 'PHYSICAL_DAMAGE',    'Physical damage — bruising, crushing, or packaging failure'
        PRE_EXISTING_SPOILAGE = 'PRE_EXISTING_SPOILAGE', 'Pre-existing spoilage — already degraded at distributor'
        DELAY              = 'DELAY',              'Delay — collection trip exceeded safe window for this crop'
        OTHER              = 'OTHER',              'Other — see notes'

    order        = models.ForeignKey('distribution.Order', on_delete=models.PROTECT,
                                     related_name='collection_confirmations')
    market_agent = models.ForeignKey(MarketAgent, on_delete=models.PROTECT, related_name='collection_confirmations')

    # Step 1 — At distributor
    quantity_collected_kg      = models.DecimalField(max_digits=10, decimal_places=2)
    collected_at               = models.DateTimeField()
    step1_idempotency_key      = models.UUIDField(unique=True, help_text="UUID from device — prevents duplicate offline submissions")

    # Step 2 — At stall (all nullable — optional step)
    quantity_arrived_at_stall_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    condition_code               = models.CharField(max_length=30, choices=ConditionCode.choices, null=True, blank=True)
    condition_notes              = models.TextField(blank=True)
    arrived_at                   = models.DateTimeField(null=True, blank=True)
    step2_idempotency_key        = models.UUIDField(unique=True, null=True, blank=True)

    # Computed field — set by system after step 2 or after step 1 if step 2 not expected
    self_transport_loss_kg  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    self_transport_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Collection #{self.id} by {self.market_agent} for Order #{self.order_id}"

    def calculate_self_transport_loss(self):
        """
        Calculate self-transport loss.
        If step 2 arrival quantity provided: loss = collected - arrived.
        If step 2 not provided: conservative default = 0.
        """
        if self.quantity_arrived_at_stall_kg is not None:
            loss_kg = max(0, float(self.quantity_collected_kg) - float(self.quantity_arrived_at_stall_kg))
            loss_pct = (loss_kg / float(self.quantity_collected_kg) * 100) if float(self.quantity_collected_kg) > 0 else 0
            self.self_transport_loss_kg = round(loss_kg, 2)
            self.self_transport_loss_pct = round(loss_pct, 2)
        else:
            # Conservative default: no self-transport loss recorded
            self.self_transport_loss_kg = 0
            self.self_transport_loss_pct = 0
        return self.self_transport_loss_kg


class WasteReport(models.Model):
    """
    End-of-day or weekly waste report submitted by a market agent.
    This closes the loss tracking loop for a batch.
    Uses idempotency_key to prevent duplicate submissions from offline queue.
    """

    class DiscardReason(models.TextChoices):
        SPOILAGE  = 'SPOILAGE',  'Spoilage — natural deterioration'
        NO_DEMAND = 'NO_DEMAND', 'No demand — produce not sold before spoilage'
        DAMAGE    = 'DAMAGE',    'Physical damage at stall'
        OTHER     = 'OTHER',     'Other — see notes'

    market_agent           = models.ForeignKey(MarketAgent, on_delete=models.PROTECT, related_name='waste_reports')
    order                  = models.ForeignKey('distribution.Order', on_delete=models.PROTECT,
                                               related_name='waste_reports', null=True, blank=True)
    # Nullable for the same reason as CooperativeWasteReport.crop — grandfathers in reports
    # filed before this field existed; the multi-crop-row submission form always sets it now.
    crop                   = models.ForeignKey('cooperatives.Crop', on_delete=models.PROTECT, null=True, blank=True,
                                               related_name='market_agent_waste_reports')
    reporting_period_start = models.DateField()
    reporting_period_end   = models.DateField()

    quantity_sold_kg       = models.DecimalField(max_digits=10, decimal_places=2)
    quantity_discarded_kg  = models.DecimalField(max_digits=10, decimal_places=2)
    discard_reason         = models.CharField(max_length=20, choices=DiscardReason.choices)
    discard_notes          = models.TextField(blank=True)

    # Market-level loss is calculated by the system: discard / (sold + discarded)
    market_spoilage_loss_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    submitted_at      = models.DateTimeField(auto_now_add=True)
    idempotency_key   = models.UUIDField(unique=True, help_text="UUID from device — prevents duplicate offline submissions")

    class Meta:
        ordering = ['-submitted_at']

    def __str__(self):
        return f"Waste Report by {self.market_agent} — {self.reporting_period_end}"

    def calculate_spoilage_loss(self):
        total = float(self.quantity_sold_kg) + float(self.quantity_discarded_kg)
        if total > 0:
            pct = (float(self.quantity_discarded_kg) / total) * 100
            self.market_spoilage_loss_pct = round(pct, 2)
        else:
            self.market_spoilage_loss_pct = 0
        return self.market_spoilage_loss_pct


class MarketPriceRecord(models.Model):
    """
    A market agent's on-the-ground price observation for a crop at a specific market —
    the two ends of one real-time price-reporting loop: agents submit these from
    PriceRecording (mobile), and every role browses the resulting national price board
    on the distributor-facing Market Prices page.
    """

    class QualityGrade(models.TextChoices):
        GRADE_A = 'A', 'Grade A — Excellent'
        GRADE_B = 'B', 'Grade B — Good'
        GRADE_C = 'C', 'Grade C — Fair'

    market_agent  = models.ForeignKey(MarketAgent, on_delete=models.CASCADE, related_name='price_records')
    crop          = models.ForeignKey('cooperatives.Crop', on_delete=models.PROTECT, related_name='market_price_records')
    market_name   = models.CharField(max_length=200)
    price_per_kg  = models.DecimalField(max_digits=10, decimal_places=2)
    quality_grade = models.CharField(max_length=1, choices=QualityGrade.choices, default=QualityGrade.GRADE_A)
    notes         = models.TextField(blank=True)
    recorded_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-recorded_at']
        indexes = [models.Index(fields=['crop', 'market_name', 'recorded_at'])]

    def __str__(self):
        return f"{self.crop.name} @ {self.market_name}: {self.price_per_kg} RWF/kg ({self.market_agent})"
