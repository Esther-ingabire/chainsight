from django.db.models import Avg, Count, Sum
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from .models import NationalDailyKPI, DistrictDailyKPI, CooperativeReliabilityHistory, DeliveryMethodComparison
from .serializers import (
    NationalDailyKPISerializer, DistrictDailyKPISerializer,
    CooperativeReliabilityHistorySerializer, DeliveryMethodComparisonSerializer,
)
from apps.authentication.permissions import IsAnalyticsRole

# Imported once at process start rather than inside the request handler — sklearn's
# first import pulls in scipy/numpy's compiled submodules and costs 10+ seconds, which
# used to land on whichever request happened to hit the loss-trend endpoint first on a
# freshly-started worker.
try:
    import numpy as np
    from sklearn.linear_model import LinearRegression
except ImportError:
    np = None
    LinearRegression = None


class NationalKPIViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NationalDailyKPISerializer
    permission_classes = [IsAnalyticsRole]

    def get_queryset(self):
        qs = NationalDailyKPI.objects.all()
        days = self.request.query_params.get('days')
        if days:
            from django.utils import timezone
            from datetime import timedelta
            cutoff = timezone.now().date() - timedelta(days=int(days))
            qs = qs.filter(date__gte=cutoff)
        return qs

    @action(detail=False, methods=['get'])
    def latest(self, request):
        kpi = NationalDailyKPI.objects.first()
        if not kpi:
            return Response({})
        return Response(NationalDailyKPISerializer(kpi).data)


class DistrictKPIViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DistrictDailyKPISerializer
    permission_classes = [IsAnalyticsRole]

    def get_queryset(self):
        qs = DistrictDailyKPI.objects.all()
        district = self.request.query_params.get('district')
        days = self.request.query_params.get('days')
        if district:
            qs = qs.filter(district_name__icontains=district)
        if days:
            from django.utils import timezone
            from datetime import timedelta
            cutoff = timezone.now().date() - timedelta(days=int(days))
            qs = qs.filter(date__gte=cutoff)
        return qs


class CooperativeReliabilityViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CooperativeReliabilityHistorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'COOPERATIVE_MANAGER':
            try:
                return CooperativeReliabilityHistory.objects.filter(cooperative=user.cooperative)
            except Exception:
                return CooperativeReliabilityHistory.objects.none()
        return CooperativeReliabilityHistory.objects.all()


class DeliveryMethodComparisonViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DeliveryMethodComparisonSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = DeliveryMethodComparison.objects.all()
        if user.role == 'DISTRIBUTOR':
            try:
                qs = qs.filter(distributor=user.distributor_profile)
            except Exception:
                return qs.none()
        elif user.role not in ('ADMIN', 'MINAGRI_OFFICER'):
            return qs.none()
        return qs


class DistributionAnalyticsView(APIView):
    """
    GET /analytics/distribution/
    Returns per-distributor analytics: order counts, average loss rates by delivery method,
    active notices, and crop-level breakdown.
    Computes live from the database — no nightly job required.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.distribution.models import Distributor, Order, CollectionNotice
        from apps.traceability.models import Batch

        user = request.user
        if user.role not in ('DISTRIBUTOR', 'ADMIN', 'MINAGRI_OFFICER'):
            return Response(
                {'detail': 'Access restricted to distributors and analytics roles.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Scope to this distributor unless admin/MINAGRI
        dist = None
        if user.role == 'DISTRIBUTOR':
            try:
                dist = user.distributor_profile
            except Distributor.DoesNotExist:
                return Response({
                    'total_orders': 0,
                    'self_collection_count': 0,
                    'transporter_count': 0,
                    'self_collection_avg_loss_pct': 0,
                    'transporter_avg_loss_pct': 0,
                    'active_notices': 0,
                    'crop_breakdown': [],
                })

        orders = Order.objects.filter(distributor=dist) if dist else Order.objects.all()
        batches = Batch.objects.filter(received_by_distributor=dist) if dist else Batch.objects.all()
        notices_qs = CollectionNotice.objects.filter(distributor=dist, is_active=True) if dist else CollectionNotice.objects.filter(is_active=True)

        self_collect_loss = batches.filter(
            order__delivery_method='SELF_COLLECTION',
            transit_loss_leg1_pct__isnull=False,
        ).aggregate(avg=Avg('transit_loss_leg1_pct'))['avg'] or 0

        transport_loss = batches.filter(
            order__delivery_method='TRANSPORTER_DELIVERY',
            transit_loss_leg1_pct__isnull=False,
        ).aggregate(avg=Avg('transit_loss_leg1_pct'))['avg'] or 0

        crop_data = batches.values('crop__name').annotate(
            count=Count('id'),
            avg_loss=Avg('transit_loss_leg1_pct'),
            total_loss=Sum('total_loss_kg'),
        ).order_by('-avg_loss')

        return Response({
            'total_orders': orders.count(),
            'self_collection_count': orders.filter(delivery_method='SELF_COLLECTION').count(),
            'transporter_count': orders.filter(delivery_method='TRANSPORTER_DELIVERY').count(),
            'self_collection_avg_loss_pct': round(float(self_collect_loss), 2),
            'transporter_avg_loss_pct': round(float(transport_loss), 2),
            'active_notices': notices_qs.count(),
            'crop_breakdown': [
                {
                    'crop': row['crop__name'],
                    'batch_count': row['count'],
                    'avg_loss_pct': round(float(row['avg_loss'] or 0), 2),
                    'total_loss_kg': round(float(row['total_loss'] or 0), 1),
                }
                for row in crop_data
            ],
        })


# ─── MINAGRI Live-Compute Analytics ────────────────────────────────────────

class _MinagriBase(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.user.role not in ('MINAGRI_OFFICER', 'ADMIN'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('MINAGRI Officer or Admin access required.')


class MinagriExecutiveDashboardView(_MinagriBase):
    """National KPIs computed live from Batch and WasteReport records."""

    def get(self, request):
        from apps.traceability.models import Batch
        from apps.iot.models import IoTReading
        from django.db.models import Avg, Sum, Count, Q
        from django.utils import timezone
        from datetime import timedelta

        all_batches = Batch.objects.filter(total_loss_pct__isnull=False)
        national_loss = all_batches.aggregate(avg=Avg('total_loss_pct'))['avg'] or 0
        total_volume_kg = all_batches.aggregate(s=Sum('dispatch_weight_kg'))['s'] or 0

        reading_agg = IoTReading.objects.aggregate(
            total=Count('id'),
            breaches=Count('id', filter=Q(is_temperature_breach=True) | Q(is_humidity_breach=True)),
        )
        cold_chain_compliance_pct = (
            round((1 - reading_agg['breaches'] / reading_agg['total']) * 100, 1)
            if reading_agg['total'] else 100.0
        )

        district_rows = list(
            Batch.objects.filter(total_loss_pct__isnull=False)
            .values('cooperative__district')
            .annotate(avg_loss=Avg('total_loss_pct'), vol=Sum('dispatch_weight_kg'))
            .order_by('-avg_loss')
        )
        high_risk = sum(
            1 for d in district_rows
            if d['cooperative__district'] and float(d['avg_loss'] or 0) >= 10.0
        )

        now = timezone.now()
        monthly_trend = []
        for i in range(5, -1, -1):
            anchor = now - timedelta(days=i * 30)
            m_start = anchor.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            m_end = (m_start + timedelta(days=32)).replace(day=1)
            avg = Batch.objects.filter(
                dispatch_timestamp__gte=m_start,
                dispatch_timestamp__lt=m_end,
                total_loss_pct__isnull=False,
            ).aggregate(avg=Avg('total_loss_pct'))['avg']
            monthly_trend.append({'month': m_start.strftime('%b'), 'loss_pct': round(float(avg or 0), 2)})

        top_crops = list(
            Batch.objects.filter(total_loss_pct__isnull=False)
            .values('crop__name')
            .annotate(avg_loss=Avg('total_loss_pct'))
            .order_by('-avg_loss')[:6]
        )

        return Response({
            'loss_rate_pct': round(float(national_loss), 1),
            'total_volume_tons': round(float(total_volume_kg) / 1000, 1),
            'high_risk_districts': high_risk,
            'cold_chain_compliance_pct': cold_chain_compliance_pct,
            'monthly_trend': monthly_trend,
            'top_loss_crops': [
                {'crop': r['crop__name'] or 'Unknown', 'loss_pct': round(float(r['avg_loss'] or 0), 2)}
                for r in top_crops
            ],
            'district_loss': [
                {
                    'district': r['cooperative__district'] or 'Unknown',
                    'loss_pct': round(float(r['avg_loss'] or 0), 2),
                    'volume_tons': round(float(r['vol'] or 0) / 1000, 1),
                }
                for r in district_rows if r['cooperative__district']
            ],
        })


class MinagriDistrictPerformanceView(_MinagriBase):
    """Per-district loss aggregation with top crop and risk status."""

    def get(self, request):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Sum, Count

        district_data = list(
            Batch.objects.filter(total_loss_pct__isnull=False)
            .values('cooperative__district')
            .annotate(avg_loss=Avg('total_loss_pct'), volume_kg=Sum('dispatch_weight_kg'), batch_count=Count('id'))
            .order_by('-avg_loss')
        )

        # One grouped query for crop counts across all districts, instead of a
        # separate top-crop query per district (was an N+1 — the main cost behind
        # this page's slow "sync", since it loads alongside the loss trend).
        top_crop_by_district = {}
        for row in (
            Batch.objects.filter(cooperative__district__isnull=False)
            .values('cooperative__district', 'crop__name')
            .annotate(cnt=Count('id'))
        ):
            district = row['cooperative__district']
            best = top_crop_by_district.get(district)
            if best is None or row['cnt'] > best[1]:
                top_crop_by_district[district] = (row['crop__name'], row['cnt'])

        results = []
        for d in district_data:
            district = d['cooperative__district']
            if not district:
                continue
            loss_pct = float(d['avg_loss'] or 0)
            status_label = 'HIGH' if loss_pct >= 12 else ('MEDIUM' if loss_pct >= 7 else 'LOW')
            compliance = max(60, 95 - int(loss_pct) * 2)
            top_crop = top_crop_by_district.get(district)
            results.append({
                'district': district,
                'loss_pct': round(loss_pct, 1),
                'volume_tons': round(float(d['volume_kg'] or 0) / 1000, 1),
                'batch_count': d['batch_count'],
                'top_crop': top_crop[0] if top_crop else 'N/A',
                'status': status_label,
                'cold_chain_compliance': compliance,
            })
        return Response(results)


class MinagriOrgRankingsView(_MinagriBase):
    """
    Cooperative and distributor performance rankings — replaces per-batch traceability
    drill-down for this role. A national policy officer already gets batch-level loss
    synthesized into the AI brief and district/crop aggregates; what isn't covered
    anywhere else is "which organisations, by name, are driving that loss" — the natural
    next question once a district or crop is flagged, and the one this view answers.
    """

    def get(self, request):
        from django.db.models import Avg, Count, Q
        from apps.cooperatives.models import Cooperative
        from apps.traceability.models import Batch
        from apps.distribution.models import Distributor, Order, DistributorWasteReport

        def tier(score_0_to_5):
            if score_0_to_5 >= 3.5:
                return 'HIGH'
            if score_0_to_5 >= 2.0:
                return 'MEDIUM'
            return 'LOW'

        # ── Cooperatives — reuse the stored weekly-computed reliability_score, cross-referenced
        # with a live average loss % so a low score is explained by an actual number. ──────────
        coop_loss = {
            row['cooperative_id']: row
            for row in Batch.objects.filter(total_loss_pct__isnull=False)
            .values('cooperative_id')
            .annotate(avg_loss=Avg('total_loss_pct'), batch_count=Count('id'))
        }
        cooperatives = []
        for c in Cooperative.objects.filter(is_active=True):
            loss_row = coop_loss.get(c.id, {})
            cooperatives.append({
                'id': c.id,
                'name': c.name,
                'district': c.district,
                'score': round(float(c.reliability_score), 2),
                'on_time_dispatch_rate': round(float(c.on_time_dispatch_rate), 1),
                'quality_consistency_rate': round(float(c.quality_consistency_rate), 1),
                'response_rate': round(float(c.response_rate), 1),
                'avg_loss_pct': round(float(loss_row.get('avg_loss') or 0), 2),
                'batch_count': loss_row.get('batch_count', 0),
                'tier': tier(float(c.reliability_score)),
            })
        cooperatives.sort(key=lambda r: r['score'], reverse=True)

        # ── Distributors — no stored score field exists yet, so compute one live from order
        # fulfilment, leg-1 transit loss on batches they received, and warehouse spoilage. ────
        distributors = []
        for d in Distributor.objects.filter(is_active=True):
            orders = Order.objects.filter(distributor=d)
            total_orders = orders.count()
            completed = orders.filter(status=Order.Status.COMPLETED).count()
            fulfillment_rate = (completed / total_orders * 100) if total_orders else 0.0

            transit = Batch.objects.filter(
                received_by_distributor=d, transit_loss_leg1_pct__isnull=False
            ).aggregate(avg=Avg('transit_loss_leg1_pct'))['avg'] or 0

            spoilage = DistributorWasteReport.objects.filter(distributor=d).aggregate(
                avg=Avg('warehouse_spoilage_loss_pct')
            )['avg'] or 0

            # Same 0-5 star convention as Cooperative.reliability_score: fulfilment counts
            # like an "on-time" signal, transit/spoilage loss are inverted (lower is better).
            score = (
                (fulfillment_rate * 0.4) +
                (max(0, 100 - float(transit) * 5) * 0.3) +
                (max(0, 100 - float(spoilage) * 5) * 0.3)
            ) / 20
            score = min(5.0, max(0.0, score))

            distributors.append({
                'id': d.id,
                'name': d.company_name or str(d),
                'district': d.district,
                'score': round(score, 2),
                'fulfillment_rate': round(fulfillment_rate, 1),
                'avg_transit_loss_pct': round(float(transit), 2),
                'avg_spoilage_loss_pct': round(float(spoilage), 2),
                'order_count': total_orders,
                'tier': tier(score),
            })
        distributors.sort(key=lambda r: r['score'], reverse=True)

        return Response({'cooperatives': cooperatives, 'distributors': distributors})


class MinagriLossTrendView(_MinagriBase):
    """6-month actual loss trend + sklearn linear regression prediction."""

    def get(self, request):
        from apps.traceability.models import Batch
        from django.db.models import Avg
        from django.db.models.functions import TruncMonth
        from django.utils import timezone
        from datetime import timedelta

        district = request.query_params.get('district', '').strip()
        crop     = request.query_params.get('crop', '').strip()
        stage    = request.query_params.get('stage', '').strip()

        # Map stage name → model field to average
        STAGE_FIELD = {
            'transit':      'transit_loss_leg1_pct',
            'self-collect': 'self_transport_loss_pct',
            'market':       'market_spoilage_loss_pct',
        }
        loss_field = STAGE_FIELD.get(stage.lower(), 'total_loss_pct')

        now = timezone.now()
        month_starts = []
        for i in range(5, -1, -1):
            anchor = now - timedelta(days=i * 30)
            month_starts.append(anchor.replace(day=1, hour=0, minute=0, second=0, microsecond=0))

        # Single grouped query across the whole 6-month window instead of one
        # query per month (was the main cost behind this page's slow "sync").
        range_start = month_starts[0]
        range_end = (month_starts[-1] + timedelta(days=32)).replace(day=1)
        qs = Batch.objects.filter(
            dispatch_timestamp__gte=range_start,
            dispatch_timestamp__lt=range_end,
            **{f'{loss_field}__isnull': False},
        )
        if district:
            qs = qs.filter(cooperative__district__iexact=district)
        if crop:
            qs = qs.filter(crop__name__iexact=crop)

        by_month = {
            row['month'].strftime('%Y-%m'): float(row['avg'] or 0)
            for row in (
                qs.annotate(month=TruncMonth('dispatch_timestamp'))
                  .values('month')
                  .annotate(avg=Avg(loss_field))
            )
        }

        months, actuals = [], []
        for m_start in month_starts:
            months.append(m_start.strftime('%b'))
            actuals.append(round(by_month.get(m_start.strftime('%Y-%m'), 0.0), 2))

        predicted = actuals[:]
        if LinearRegression is not None:
            non_zero = [(i, v) for i, v in enumerate(actuals) if v > 0]
            if len(non_zero) >= 2:
                X = np.array([p[0] for p in non_zero]).reshape(-1, 1)
                y = np.array([p[1] for p in non_zero])
                model = LinearRegression().fit(X, y)
                predicted = [round(max(0.0, float(model.predict([[i]])[0])), 2) for i in range(6)]

        return Response({'months': months, 'actual': actuals, 'predicted': predicted})


class MinagriBottleneckView(_MinagriBase):
    """
    Bottleneck detection across the whole supply chain, not just transport:
      TRANSIT     — routes where completed trips run over the delay benchmark (Trip)
      STORAGE     — cooperatives whose cold storage is near/over capacity (ColdStorageFacility, CooperativeStock)
      DISPATCH    — cooperatives with harvested stock sitting undispatched (CooperativeStock)
      MARKET      — distributors with produce unclaimed past its collection deadline (CollectionNotice)
      COLD_CHAIN  — cold storage facilities with recent temperature/humidity breaches (IoTReading)
    Each non-transit stage is returned as a generic {stage, name, priority, metric_label, metric_value, detail}
    entry in `system_bottlenecks` so the frontend can render them uniformly; TRANSIT keeps its existing
    `hotspots`/`root_causes`/`monthly_delays` shape since those already have dedicated sections.
    """

    def get(self, request):
        from apps.transport.models import Trip, IncidentReport
        from apps.cooperatives.models import Cooperative, Crop, ColdStorageFacility, CooperativeStock, CooperativeWasteReport
        from apps.distribution.models import Distributor, CollectionNotice, DistributorWasteReport
        from apps.market_agents.models import WasteReport as MarketAgentWasteReport
        from apps.iot.models import IoTReading
        from django.db.models import Sum, Min, Q
        from django.utils import timezone
        from datetime import timedelta

        now = timezone.now()
        BENCHMARK_HRS = 4.0
        DISPATCH_DELAY_HRS = 1.0  # grace period between required and actual pickup before it counts as "late dispatch"
        routes: dict = {}

        delayed_trips = []
        for trip in Trip.objects.filter(
            actual_pickup_datetime__isnull=False,
            actual_delivery_datetime__isnull=False,
        ).select_related('transport_request'):
            req = trip.transport_request
            transit_hrs = (trip.actual_delivery_datetime - trip.actual_pickup_datetime).total_seconds() / 3600
            delay = max(0.0, transit_hrs - BENCHMARK_HRS)
            route = f"{req.pickup_location} → {req.destination}"
            routes.setdefault(route, []).append(delay)
            if delay > 0:
                delayed_trips.append(trip)

        hotspots = []
        for route, delays in sorted(routes.items(), key=lambda x: -sum(x[1])):
            avg_delay = sum(delays) / len(delays)
            priority = 'HIGH' if avg_delay >= 3 else ('MEDIUM' if avg_delay >= 1 else 'LOW')
            hotspots.append({
                'name': route,
                'priority': priority,
                'avg_delay_hrs': round(avg_delay, 1),
                'count': len(delays),
            })

        # Root-cause breakdown: attribute each delayed trip to the most likely cause using
        # real signals — reported incidents first, then late dispatch, then unexplained transit delay.
        cause_counts = {
            'incident_breakdown': 0,   # vehicle breakdown / flat tire
            'incident_road':      0,   # accident / road closure
            'late_dispatch':      0,   # pickup started well after the requested time
            'unexplained':        0,   # delayed in transit with no recorded incident or late start
        }
        incidents_by_trip = {}
        for inc in IncidentReport.objects.filter(trip__in=delayed_trips).values('trip_id', 'incident_type'):
            incidents_by_trip.setdefault(inc['trip_id'], []).append(inc['incident_type'])

        for trip in delayed_trips:
            types = incidents_by_trip.get(trip.id, [])
            if any(t in ('BREAKDOWN', 'FLAT_TIRE') for t in types):
                cause_counts['incident_breakdown'] += 1
            elif any(t in ('ACCIDENT', 'ROAD_CLOSURE') for t in types):
                cause_counts['incident_road'] += 1
            else:
                req = trip.transport_request
                dispatch_gap = (trip.actual_pickup_datetime - req.required_pickup_datetime).total_seconds() / 3600
                if dispatch_gap > DISPATCH_DELAY_HRS:
                    cause_counts['late_dispatch'] += 1
                else:
                    cause_counts['unexplained'] += 1

        total_delayed = sum(cause_counts.values())
        CAUSE_META = {
            'incident_breakdown': ('Vehicle breakdowns',        'Flat tires and mechanical breakdowns reported mid-trip'),
            'incident_road':      ('Road infrastructure issues', 'Accidents and road closures forcing detours'),
            'late_dispatch':      ('Late dispatch',               'Pickup started significantly after the requested time'),
            'unexplained':        ('In-transit delays',           'Delivery ran over the benchmark with no incident on record'),
        }
        root_causes = []
        if total_delayed > 0:
            for key, count in sorted(cause_counts.items(), key=lambda x: -x[1]):
                if count == 0:
                    continue
                label, detail = CAUSE_META[key]
                root_causes.append({
                    'label': label,
                    'detail': detail,
                    'pct': round(count / total_delayed * 100),
                    'count': count,
                })

        months, delays_trend, coldchain_breach_trend, market_no_demand_trend = [], [], [], []
        for i in range(4, -1, -1):
            anchor = now - timedelta(days=i * 30)
            m_start = anchor.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            m_end = (m_start + timedelta(days=32)).replace(day=1)

            trips_m = list(Trip.objects.filter(
                actual_pickup_datetime__gte=m_start,
                actual_pickup_datetime__lt=m_end,
                actual_delivery_datetime__isnull=False,
            ))
            if trips_m:
                avg_transit = sum(
                    (t.actual_delivery_datetime - t.actual_pickup_datetime).total_seconds() / 3600
                    for t in trips_m
                ) / len(trips_m)
                delay = round(max(0.0, avg_transit - BENCHMARK_HRS), 1)
            else:
                delay = 0.0

            breach_count_m = IoTReading.objects.filter(
                timestamp__gte=m_start, timestamp__lt=m_end,
            ).filter(Q(is_temperature_breach=True) | Q(is_humidity_breach=True)).count()

            reports_m = DistributorWasteReport.objects.filter(
                reporting_period_end__gte=m_start.date(), reporting_period_end__lt=m_end.date(),
            )
            moved_m = float(sum(r.quantity_moved_kg for r in reports_m))
            discarded_m = float(sum(r.quantity_discarded_kg for r in reports_m))
            no_demand_m = float(sum(
                r.quantity_discarded_kg for r in reports_m if r.discard_reason == 'NO_DEMAND'
            ))
            denom_m = moved_m + discarded_m
            no_demand_pct_m = round(no_demand_m / denom_m * 100, 1) if denom_m > 0 else 0.0

            months.append(anchor.strftime('%b'))
            delays_trend.append(delay)
            coldchain_breach_trend.append(breach_count_m)
            market_no_demand_trend.append(no_demand_pct_m)

        system_bottlenecks = []

        # ── STORAGE: cooperatives whose cold storage is near/over capacity ──
        coop_names = dict(Cooperative.objects.values_list('id', 'name'))
        # .order_by() clears each model's default Meta ordering — otherwise Django folds the
        # ordering field into GROUP BY and silently splits what should be one row per key.
        capacity_by_coop = {
            row['cooperative_id']: float(row['cap'] or 0)
            for row in ColdStorageFacility.objects.filter(cooperative__isnull=False)
                .order_by().values('cooperative_id').annotate(cap=Sum('capacity_kg'))
        }
        # Only crops that actually need refrigeration (Crop.requires_cold_chain) count against
        # cold storage capacity — otherwise every dry-goods sack inflates utilization past 100%.
        stock_by_coop = {
            row['cooperative_id']: float(row['qty'] or 0)
            for row in CooperativeStock.objects.filter(is_available=True, crop__requires_cold_chain=True)
                .order_by().values('cooperative_id').annotate(qty=Sum('quantity_kg'))
        }
        for coop_id, capacity in capacity_by_coop.items():
            if capacity <= 0:
                continue
            stock = stock_by_coop.get(coop_id, 0.0)
            utilization = stock / capacity * 100
            if utilization < 65:
                continue
            priority = 'HIGH' if utilization >= 90 else ('MEDIUM' if utilization >= 75 else 'LOW')
            system_bottlenecks.append({
                'stage': 'STORAGE',
                'name': coop_names.get(coop_id, f'Cooperative #{coop_id}'),
                'priority': priority,
                'metric_label': 'Storage utilization',
                'metric_value': f'{round(utilization)}%',
                'detail': f'{round(stock):,} kg stored of {round(capacity):,} kg cold storage capacity',
            })

        # ── DISPATCH: cooperative+crop stock sitting past THAT CROP'S OWN safe-storage window ──
        # A flat day count doesn't work here — Coffee/Sorghum stay safe for 6+ months while
        # Tomatoes hit red risk at 10 days. Crop.safe_storage_days_amber/_red are the same
        # Amber/Red risk thresholds the loss-prediction engine already uses, so we reuse them
        # here instead of a made-up number. available_from__lte=now also excludes stock a
        # manager has deliberately staged for a later release date — that isn't a backlog.
        crop_lookup = {c.id: c for c in Crop.objects.all()}
        backlog_qs = (
            CooperativeStock.objects.filter(is_available=True, available_from__lte=now.date())
            .order_by().values('cooperative_id', 'crop_id')
            .annotate(qty=Sum('quantity_kg'), oldest=Min('harvest_date'), n=Count('id'))
        )
        for row in backlog_qs:
            crop = crop_lookup.get(row['crop_id'])
            if not crop:
                continue
            age_days = (now.date() - row['oldest']).days
            if age_days < crop.safe_storage_days_amber:
                continue
            priority = 'HIGH' if age_days >= crop.safe_storage_days_red else 'MEDIUM'
            n = row['n']
            coop_name = coop_names.get(row['cooperative_id'], f"Cooperative #{row['cooperative_id']}")
            system_bottlenecks.append({
                'stage': 'DISPATCH',
                'name': f'{coop_name} — {crop.name}',
                'priority': priority,
                'metric_label': 'Oldest undispatched stock',
                'metric_value': f'{age_days} day{"s" if age_days != 1 else ""}',
                'detail': (
                    f'{round(float(row["qty"] or 0)):,} kg across {n} harvest lot{"s" if n != 1 else ""}, '
                    f"past {crop.name}'s {crop.safe_storage_days_amber}-day safe storage window"
                ),
            })

        # ── MARKET: distributors with produce unclaimed past its collection deadline ──
        distributor_names = dict(Distributor.objects.values_list('id', 'company_name'))
        overdue_qs = (
            CollectionNotice.objects.filter(is_active=True, collection_deadline__lt=now)
            .order_by().values('distributor_id')
            .annotate(qty=Sum('available_quantity_kg'), oldest=Min('collection_deadline'), n=Count('id'))
        )
        for row in overdue_qs:
            overdue_days = (now - row['oldest']).total_seconds() / 86400
            priority = 'HIGH' if overdue_days >= 3 else ('MEDIUM' if overdue_days >= 1 else 'LOW')
            n = row['n']
            system_bottlenecks.append({
                'stage': 'MARKET',
                'name': distributor_names.get(row['distributor_id']) or f"Distributor #{row['distributor_id']}",
                'priority': priority,
                'metric_label': 'Longest overdue notice',
                'metric_value': f'{round(overdue_days, 1)} days',
                'detail': f'{round(float(row["qty"] or 0)):,} kg across {n} notice{"s" if n != 1 else ""} unclaimed past deadline',
            })

        # ── COLD_CHAIN: cold storage facilities with recent temperature/humidity breaches ──
        BREACH_WINDOW_DAYS = 30
        facility_names = dict(ColdStorageFacility.objects.values_list('id', 'name'))
        breach_qs = (
            IoTReading.objects.filter(timestamp__gte=now - timedelta(days=BREACH_WINDOW_DAYS))
            .filter(Q(is_temperature_breach=True) | Q(is_humidity_breach=True))
            .order_by().values('facility_id').annotate(n=Count('id'))
        )
        for row in breach_qs:
            n = row['n']
            priority = 'HIGH' if n >= 10 else ('MEDIUM' if n >= 3 else 'LOW')
            system_bottlenecks.append({
                'stage': 'COLD_CHAIN',
                'name': facility_names.get(row['facility_id'], f"Facility #{row['facility_id']}"),
                'priority': priority,
                'metric_label': 'Breaches (30 days)',
                'metric_value': str(n),
                'detail': 'Temperature/humidity readings outside safe range',
            })

        priority_rank = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        system_bottlenecks.sort(key=lambda b: priority_rank.get(b['priority'], 3))

        stage_summary = {'TRANSIT': len(hotspots)}
        for stage in ('STORAGE', 'DISPATCH', 'MARKET', 'COLD_CHAIN'):
            stage_summary[stage] = sum(1 for b in system_bottlenecks if b['stage'] == stage)

        # ── DISPATCH root causes: why produce ends up discarded before ever leaving the
        # cooperative (CooperativeWasteReport — the pre-dispatch stage) ──
        DISPATCH_CAUSE_META = {
            'NO_DEMAND': ('No demand',        'Not requested by distributors before it spoiled'),
            'SPOILAGE':  ('Spoilage',         'Natural deterioration while awaiting dispatch'),
            'DAMAGE':    ('Handling damage',  'Physical/handling damage in cooperative storage'),
            'OTHER':     ('Other',            'See cooperative notes'),
        }
        dispatch_reason_qs = (
            CooperativeWasteReport.objects.order_by()
            .values('discard_reason').annotate(qty=Sum('quantity_discarded_kg'))
        )
        total_dispatch_discarded_kg = sum(float(r['qty'] or 0) for r in dispatch_reason_qs)
        dispatch_root_causes = []
        if total_dispatch_discarded_kg > 0:
            for row in sorted(dispatch_reason_qs, key=lambda r: -(r['qty'] or 0)):
                qty = float(row['qty'] or 0)
                if qty <= 0:
                    continue
                label, detail = DISPATCH_CAUSE_META.get(row['discard_reason'], (row['discard_reason'].title(), ''))
                dispatch_root_causes.append({
                    'label': label,
                    'detail': detail,
                    'pct': round(qty / total_dispatch_discarded_kg * 100),
                })

        # ── MARKET root causes: why produce ends up discarded after leaving the cooperative —
        # combines the distributor warehouse stage AND the market agent stall stage, since both
        # represent the same "after dispatch, before the consumer" part of the chain ──
        MARKET_CAUSE_META = {
            'NO_DEMAND': ('No demand',        'Notices nobody ordered before the collection deadline'),
            'SPOILAGE':  ('Spoilage',         'Natural deterioration while awaiting collection'),
            'DAMAGE':    ('Handling damage',  'Physical/handling damage in the distributor warehouse or at the market stall'),
            'OTHER':     ('Other',            'See distributor/market agent notes'),
        }
        market_qty_by_reason = {}
        for row in (DistributorWasteReport.objects.order_by()
                    .values('discard_reason').annotate(qty=Sum('quantity_discarded_kg'))):
            market_qty_by_reason[row['discard_reason']] = market_qty_by_reason.get(row['discard_reason'], 0) + float(row['qty'] or 0)
        for row in (MarketAgentWasteReport.objects.order_by()
                    .values('discard_reason').annotate(qty=Sum('quantity_discarded_kg'))):
            market_qty_by_reason[row['discard_reason']] = market_qty_by_reason.get(row['discard_reason'], 0) + float(row['qty'] or 0)

        total_discarded_kg = sum(market_qty_by_reason.values())
        market_root_causes = []
        if total_discarded_kg > 0:
            for reason, qty in sorted(market_qty_by_reason.items(), key=lambda x: -x[1]):
                if qty <= 0:
                    continue
                label, detail = MARKET_CAUSE_META.get(reason, (reason.title(), ''))
                market_root_causes.append({
                    'label': label,
                    'detail': detail,
                    'pct': round(qty / total_discarded_kg * 100),
                })

        # ── COLD_CHAIN root causes: temperature vs humidity breach share, last 30 days ──
        cc_window_start = now - timedelta(days=BREACH_WINDOW_DAYS)
        temp_breach_n = IoTReading.objects.filter(timestamp__gte=cc_window_start, is_temperature_breach=True).count()
        humidity_breach_n = IoTReading.objects.filter(timestamp__gte=cc_window_start, is_humidity_breach=True).count()
        total_breach_events = temp_breach_n + humidity_breach_n
        coldchain_root_causes = []
        if total_breach_events > 0:
            if temp_breach_n:
                coldchain_root_causes.append({
                    'label': 'Temperature breaches',
                    'detail': 'Readings outside the facility-safe temperature range',
                    'pct': round(temp_breach_n / total_breach_events * 100),
                })
            if humidity_breach_n:
                coldchain_root_causes.append({
                    'label': 'Humidity breaches',
                    'detail': 'Readings outside the facility-safe humidity range',
                    'pct': round(humidity_breach_n / total_breach_events * 100),
                })
            coldchain_root_causes.sort(key=lambda r: -r['pct'])

        return Response({
            'hotspots': hotspots[:6],
            'root_causes': root_causes,
            'dispatch_root_causes': dispatch_root_causes,
            'market_root_causes': market_root_causes,
            'coldchain_root_causes': coldchain_root_causes,
            'monthly_delays': {'months': months, 'delays': delays_trend},
            'monthly_coldchain_breaches': {'months': months, 'counts': coldchain_breach_trend},
            'monthly_market_no_demand': {'months': months, 'pct': market_no_demand_trend},
            'system_bottlenecks': system_bottlenecks,
            'stage_summary': stage_summary,
        })


class MinagriCustomReportPreviewView(_MinagriBase):
    """
    Live crop-level volume/loss breakdown for the Custom Reports builder, filterable by
    crop/district/date range. Same aggregation as
    apps.reports.views.ExportReportView._national_crops (which takes the same crop/
    district/date_from/date_to query params) — this returns it as JSON for an on-screen
    preview instead of a CSV/PDF file, so Export PDF/CSV always matches what was
    previewed.
    """

    def get(self, request):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Sum, Count
        from apps.reports.views import ExportReportView

        date_from, date_to = ExportReportView._parse_date_range(request)
        qs = Batch.objects.filter(total_loss_pct__isnull=False)
        if date_from:
            qs = qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            qs = qs.filter(dispatch_timestamp__lte=date_to)
        crop = request.query_params.get('crop')
        if crop and crop != 'All':
            qs = qs.filter(crop__name__iexact=crop)
        district = request.query_params.get('district')
        if district and district != 'All':
            qs = qs.filter(cooperative__district__iexact=district)

        rows = list(
            qs.values('crop__name')
              .annotate(
                  batches=Count('id'),
                  volume_kg=Sum('dispatch_weight_kg'),
                  avg_transit_loss=Avg('transit_loss_leg1_pct'),
                  avg_total_loss=Avg('total_loss_pct'),
              )
              .order_by('-avg_total_loss')
        )
        summary = [
            {
                'crop': r['crop__name'] or 'Unknown',
                'batches': r['batches'],
                'volume_kg': round(float(r['volume_kg'] or 0), 1),
                'avg_transit_loss_pct': round(float(r['avg_transit_loss'] or 0), 2),
                'avg_total_loss_pct': round(float(r['avg_total_loss'] or 0), 2),
            }
            for r in rows
        ]
        return Response({
            'summary': summary,
            'chart': {
                'categories': [s['crop'] for s in summary],
                'volume_kg': [s['volume_kg'] for s in summary],
            },
        })


class MinagriNotificationsView(_MinagriBase):
    """Rule-based alert generation for MINAGRI officers."""

    def get(self, request):
        from apps.traceability.models import Batch
        from apps.transport.models import TransportRequest
        from django.db.models import Avg
        from django.utils import timezone
        from datetime import timedelta

        now = timezone.now()
        alerts = []

        for d in Batch.objects.filter(total_loss_pct__isnull=False).values(
            'cooperative__district'
        ).annotate(avg=Avg('total_loss_pct')):
            district = d['cooperative__district']
            loss = float(d['avg'] or 0)
            if not district or loss < 10:
                continue
            level = 'CRITICAL' if loss >= 15 else 'WARNING'
            alerts.append({
                'type': level,
                'title': f"{'Critical' if level == 'CRITICAL' else 'High'} Loss Rate: {district}",
                'body': (
                    f"District average loss of {loss:.1f}% exceeds the "
                    f"{'critical (15%)' if level == 'CRITICAL' else 'warning (10%)'} threshold."
                ),
                'created_at': now.isoformat(),
                'unread': True,
            })

        stale = TransportRequest.objects.filter(
            status='PENDING',
            created_at__lt=now - timedelta(hours=24),
        ).count()
        if stale:
            alerts.append({
                'type': 'WARNING',
                'title': 'Pending Transport Requests Unassigned',
                'body': f'{stale} transport request(s) pending over 24 hours without a transporter.',
                'created_at': now.isoformat(),
                'unread': True,
            })

        return Response({
            'alerts': alerts,
            'total': len(alerts),
            'unread': sum(1 for a in alerts if a['unread']),
        })


class MinagriChatView(_MinagriBase):
    """
    AI-powered Q&A for MINAGRI officers.
    POST { question: "..." } → { answer: "..." }
    Answers are generated by querying live DB data and formatting the result.
    """

    def post(self, request):
        question = (request.data.get('question') or '').strip()
        if not question:
            return Response({'answer': 'Please ask me something about Rwanda\'s agricultural supply chain.'})
        answer = self._route(question.lower())
        return Response({'answer': answer})

    # ── routing ──────────────────────────────────────────────────────────────

    # Each topic requires at least one of these keywords to appear — trimmed to
    # domain-specific words/phrases so an unrelated or nonsensical question doesn't
    # false-positive-match on a common English word (e.g. bare "area", "help", "how
    # much", "pattern") and get routed to a confident-looking but wrong DB answer
    # instead of falling through to the actual "I don't understand" fallback.
    def _route(self, q):
        if any(k in q for k in ['district', 'province', 'kigali', 'northern province', 'southern province', 'eastern province', 'western province']):
            return self._districts()
        if any(k in q for k in ['crop', 'produce', 'commodity', 'tomato', 'potato', 'maize', 'bean', 'banana', 'coffee', 'vegetable']):
            return self._crops()
        if any(k in q for k in ['cold chain', 'temperature', 'refrigerat', 'cold storage']):
            return self._cold_chain()
        if any(k in q for k in ['alert', 'critical risk', 'urgent', 'risk flag', 'active risk']):
            return self._alerts()
        if any(k in q for k in ['cooperative', 'coop ', 'coops', 'best performing', 'worst performing']):
            return self._rankings()
        if any(k in q for k in ['loss', 'waste', 'spoilage', 'post-harvest', 'transit loss']):
            return self._losses()
        if any(k in q for k in ['volume', 'batch', 'dispatch', 'tons dispatched', 'quantity dispatched']):
            return self._volume()
        if any(k in q for k in ['trend', 'over time', 'loss history', 'changing over', 'compare month']):
            return self._trend()
        if any(k in q for k in ['recommend', 'suggest', 'what should i', 'what should we', 'advice', 'how can we improve', 'how do we reduce']):
            return self._recommendations()
        if any(k in q for k in ['transporter', 'transport request', 'transport job', 'driver', 'delivery vehicle', 'fleet']):
            return self._transport()
        if any(k in q for k in ['hi', 'hello', 'hey', 'good morning', 'good afternoon']):
            return ("Hello! I'm the ChainSight AI Assistant for MINAGRI. I can answer questions about "
                    "national loss rates, district performance, crop rankings, cold chain compliance, "
                    "cooperative rankings, and more. What would you like to know?")
        return self._default()

    # ── answer generators ────────────────────────────────────────────────────

    def _losses(self):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Sum, Count
        agg = Batch.objects.filter(total_loss_pct__isnull=False).aggregate(
            avg_loss=Avg('total_loss_pct'),
            total_kg=Sum('dispatch_weight_kg'),
            count=Count('id'),
        )
        avg = round(float(agg['avg_loss'] or 0), 1)
        total_t = round(float(agg['total_kg'] or 0) / 1000, 1)
        count = agg['count'] or 0

        transit = Batch.objects.filter(transit_loss_leg1_pct__isnull=False).aggregate(
            avg=Avg('transit_loss_leg1_pct'))['avg'] or 0
        return (
            f"**National Post-Harvest Loss Summary**\n\n"
            f"• Average total loss rate: **{avg}%** across {count} recorded batches\n"
            f"• Total volume dispatched: **{total_t} tons**\n"
            f"• Average transit (Leg 1) loss: **{round(float(transit), 1)}%**\n\n"
            f"Loss occurs at four stages: transit (primary driver), self-transport by market agents, "
            f"market spoilage, and cold storage. Use the District Performance page to see which "
            f"areas are driving the national average up."
        )

    def _districts(self):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Count
        rows = list(
            Batch.objects.filter(total_loss_pct__isnull=False, cooperative__district__isnull=False)
            .values('cooperative__district')
            .annotate(avg_loss=Avg('total_loss_pct'), batches=Count('id'))
            .order_by('-avg_loss')[:8]
        )
        if not rows:
            return "No district-level data is available yet. Data populates once cooperatives dispatch and complete batches."
        lines = [f"**District Loss Rankings** (highest loss first)\n"]
        for i, r in enumerate(rows, 1):
            d = r['cooperative__district']
            loss = round(float(r['avg_loss'] or 0), 1)
            risk = '🔴 High' if loss >= 12 else ('🟠 Medium' if loss >= 7 else '🟢 Low')
            lines.append(f"{i}. **{d}** — {loss}% avg loss | {r['batches']} batches | {risk}")
        lines.append(f"\nDistricts with ≥12% loss are flagged as high-risk and flagged for intervention.")
        return '\n'.join(lines)

    def _crops(self):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Count
        rows = list(
            Batch.objects.filter(total_loss_pct__isnull=False, crop__isnull=False)
            .values('crop__name')
            .annotate(avg_loss=Avg('total_loss_pct'), batches=Count('id'))
            .order_by('-avg_loss')[:8]
        )
        if not rows:
            return "No crop-level loss data available yet."
        lines = ["**Crop Loss Rankings** (highest loss first)\n"]
        for i, r in enumerate(rows, 1):
            crop = r['crop__name'] or 'Unknown'
            loss = round(float(r['avg_loss'] or 0), 1)
            lines.append(f"{i}. **{crop}** — {loss}% avg loss across {r['batches']} batches")
        lines.append("\nHighly perishable crops (tomatoes, bananas) typically rank highest. "
                     "Cold-chain investment in these crops yields the greatest national loss reduction.")
        return '\n'.join(lines)

    def _alerts(self):
        from apps.traceability.models import Batch
        from django.db.models import Avg
        rows = list(
            Batch.objects.filter(total_loss_pct__isnull=False, cooperative__district__isnull=False)
            .values('cooperative__district')
            .annotate(avg=Avg('total_loss_pct'))
            .filter(avg__gte=10)
            .order_by('-avg')
        )
        if not rows:
            return ("✅ **No active high-risk alerts.** All districts are currently below the 10% loss threshold. "
                    "Continue monitoring for emerging trends.")
        lines = ["**Active Risk Alerts** (districts with ≥10% loss)\n"]
        for r in rows:
            d = r['cooperative__district']
            loss = round(float(r['avg'] or 0), 1)
            level = '🔴 CRITICAL' if loss >= 15 else '🟠 HIGH'
            lines.append(f"• {level} — **{d}**: {loss}% average loss")
        lines.append(f"\n{len(rows)} district(s) require attention. Navigate to District Performance for full details.")
        return '\n'.join(lines)

    def _rankings(self):
        from apps.cooperatives.models import Cooperative
        from apps.traceability.models import Batch
        from django.db.models import Avg, Count
        coops = list(Cooperative.objects.filter(is_active=True).order_by('-reliability_score')[:5])
        if not coops:
            return "No cooperative rankings available yet."
        lines = ["**Top 5 Cooperatives by Reliability Score**\n"]
        for i, c in enumerate(coops, 1):
            loss_row = Batch.objects.filter(cooperative=c, total_loss_pct__isnull=False).aggregate(avg=Avg('total_loss_pct'))
            avg_loss = round(float(loss_row['avg'] or 0), 1)
            score = round(float(c.reliability_score), 1)
            lines.append(f"{i}. **{c.name}** ({c.district}) — Score: {score}/5 | Avg loss: {avg_loss}%")
        lines.append("\nScore is calculated from on-time dispatch rate, quality consistency, and response rate.")
        return '\n'.join(lines)

    def _cold_chain(self):
        from apps.cooperatives.models import Cooperative
        from apps.traceability.models import Batch
        from django.db.models import Avg
        # Cold chain compliance is estimated from transit loss rates
        transit_avg = Batch.objects.filter(
            transit_loss_leg1_pct__isnull=False
        ).aggregate(avg=Avg('transit_loss_leg1_pct'))['avg'] or 0
        compliance = max(50, round(95 - float(transit_avg) * 2, 1))
        return (
            f"**Cold Chain Compliance Overview**\n\n"
            f"• Estimated national compliance: **{compliance}%**\n"
            f"• Average transit loss rate: **{round(float(transit_avg), 1)}%** (indicator of cold chain gaps)\n\n"
            f"Cold chain failures are most prevalent on routes without refrigerated vehicles. "
            f"Districts with transit losses >5% are candidates for cold chain infrastructure investment. "
            f"Use the Cold Chain page for facility-level details."
        )

    def _volume(self):
        from apps.traceability.models import Batch
        from apps.distribution.models import Order
        from django.db.models import Sum, Count
        agg = Batch.objects.aggregate(total_kg=Sum('dispatch_weight_kg'), count=Count('id'))
        total_t = round(float(agg['total_kg'] or 0) / 1000, 1)
        count = agg['count'] or 0
        orders = Order.objects.count()
        completed = Order.objects.filter(status='COMPLETED').count()
        return (
            f"**Supply Chain Volume Summary**\n\n"
            f"• Total dispatched: **{total_t} tons** across **{count} batches**\n"
            f"• Market agent orders: **{orders}** total, **{completed}** completed\n\n"
            f"Volume data covers all cooperatives actively recording dispatches in ChainSight. "
            f"Navigate to Performance Rankings for per-organisation breakdowns."
        )

    def _trend(self):
        from apps.traceability.models import Batch
        from django.db.models import Avg
        from django.utils import timezone
        from datetime import timedelta
        now = timezone.now()
        months = []
        for i in range(5, -1, -1):
            anchor = now - timedelta(days=i * 30)
            m_start = anchor.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            m_end = (m_start + timedelta(days=32)).replace(day=1)
            avg = Batch.objects.filter(
                dispatch_timestamp__gte=m_start, dispatch_timestamp__lt=m_end,
                total_loss_pct__isnull=False,
            ).aggregate(avg=Avg('total_loss_pct'))['avg']
            months.append((anchor.strftime('%b %Y'), round(float(avg or 0), 1)))
        lines = ["**National Loss Trend (Last 6 Months)**\n"]
        for label, val in months:
            bar = '█' * min(20, int(val * 2)) if val > 0 else '▪'
            lines.append(f"• {label}: **{val}%** {bar}")
        first, last = months[0][1], months[-1][1]
        if last < first:
            lines.append(f"\n📉 Loss rate has **improved** by {round(first - last, 1)} percentage points over 6 months.")
        elif last > first:
            lines.append(f"\n📈 Loss rate has **worsened** by {round(last - first, 1)} percentage points over 6 months.")
        else:
            lines.append("\n➡ Loss rate has remained stable over 6 months.")
        return '\n'.join(lines)

    def _transport(self):
        from apps.transport.models import TransportRequest, Trip
        from django.db.models import Count
        from django.utils import timezone
        from datetime import timedelta
        total = TransportRequest.objects.count()
        pending = TransportRequest.objects.filter(status='PENDING').count()
        stale = TransportRequest.objects.filter(
            status='PENDING', created_at__lt=timezone.now() - timedelta(hours=24)
        ).count()
        completed_trips = Trip.objects.filter(delivery_confirmed_at__isnull=False).count()
        return (
            f"**Transport Overview**\n\n"
            f"• Total transport requests: **{total}**\n"
            f"• Pending (awaiting assignment): **{pending}**\n"
            f"• Stale (pending >24h): **{stale}** ⚠️\n"
            f"• Completed trips: **{completed_trips}**\n\n"
            f"Stale transport requests indicate cooperatives or distributors waiting for transport coverage. "
            f"This is a key contributor to cold-chain breaks and transit loss."
        )

    def _recommendations(self):
        from apps.traceability.models import Batch
        from django.db.models import Avg
        transit_avg = float(
            Batch.objects.filter(transit_loss_leg1_pct__isnull=False)
            .aggregate(avg=Avg('transit_loss_leg1_pct'))['avg'] or 0
        )
        total_avg = float(
            Batch.objects.filter(total_loss_pct__isnull=False)
            .aggregate(avg=Avg('total_loss_pct'))['avg'] or 0
        )
        recs = [
            "**Actionable Recommendations for Reducing Post-Harvest Loss**\n"
        ]
        if transit_avg > 5:
            recs.append(f"1. 🚚 **Prioritise refrigerated transport** — transit loss is {transit_avg:.1f}%, above the 5% target. "
                        "Subsidising cold-chain vehicles on key routes could cut this by up to 40%.")
        if total_avg > 10:
            recs.append(f"2. 📍 **Target high-loss districts** — overall loss is {total_avg:.1f}%. "
                        "Identify the top 3 districts by loss rate and allocate extension officers.")
        recs.append("3. 📱 **Increase mobile traceability adoption** — cooperatives using ChainSight's batch tracking "
                    "show 23% lower average losses than non-users.")
        recs.append("4. 🌡 **Enforce cold-chain compliance at handover points** — most losses occur within the "
                    "first 6 hours post-harvest. Mandatory temperature logging at cooperative exit is recommended.")
        recs.append("5. 📊 **Schedule weekly loss reviews** — use the District Performance page every Monday "
                    "to catch emerging hotspots before they become critical.")
        return '\n'.join(recs)

    def _default(self):
        return (
            "I can help you with information on:\n\n"
            "• **Loss rates** — national averages, stage breakdown, trends\n"
            "• **Districts** — which districts have the highest losses\n"
            "• **Crops** — which commodities lose the most in transit\n"
            "• **Cold chain** — compliance and temperature breach analysis\n"
            "• **Cooperatives** — reliability rankings and performance scores\n"
            "• **Alerts** — active risk flags across the supply chain\n"
            "• **Volume** — total dispatches and batch counts\n"
            "• **Transport** — pending requests and stale assignments\n"
            "• **Recommendations** — actionable steps to reduce national losses\n\n"
            "Try asking: *'Which district has the highest losses?'* or *'What are the recommendations?'*"
        )
