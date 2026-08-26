"""
python manage.py reset_demo_state

Resets THE ENTIRE SYSTEM back to a clean, presentation-ready state.
Run this before every demo or presentation session.

What it resets:
  TRANSPORT
  - All demo transport company requests → back to PENDING (ready to dispatch)
  - All active/accepted trips for demo drivers → cancelled, requests restored to PENDING
  - 3 fresh PENDING requests created for individual drivers (Patrick, Diane, Claudine)
  - Patrick (Kalinda) and Claudine (Gasana) each get a fresh active trip with GPS tracks,
    temperature readings (one breach), and an open incident — so both companies' Fleet
    Monitoring pages have a live map, breach, and incident to show right after a reset.

  WAREHOUSE
  - All accepted/declined warehouse rental requests → back to PENDING
  - 4 fresh PENDING rental requests created if needed
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
import datetime


class Command(BaseCommand):
    help = 'Reset demo transport requests back to PENDING so the presentation flow works again'

    def handle(self, *args, **options):
        from apps.transport.models import Transporter, TransportRequest, Trip, Vehicle
        from apps.cooperatives.models import Cooperative

        self.stdout.write('Resetting demo state...\n')

        # ── 1. Find the two demo transport companies ───────────────────────
        try:
            kalinda = Transporter.objects.get(user__email='a.kalinda@chainsight.demo')
            gasana  = Transporter.objects.get(user__email='e.gasana@chainsight.demo')
        except Transporter.DoesNotExist:
            self.stderr.write('Demo company accounts not found — run seed_demo_data first.')
            return

        company_ids = [kalinda.id, gasana.id]
        driver_ids  = list(
            Transporter.objects.filter(parent_company__in=company_ids).values_list('id', flat=True)
        )
        all_transporter_ids = company_ids + driver_ids

        # ── 2. Reset all ACCEPTED/IN_PROGRESS requests back to PENDING ─────
        # Collect requests that need resetting (ACCEPTED or IN_PROGRESS for demo accounts)
        active_reqs = TransportRequest.objects.filter(
            transporter_id__in=all_transporter_ids,
            status__in=['ACCEPTED', 'IN_PROGRESS'],
        ).select_related('transporter')

        # Delete their trips first (FK is PROTECTED so must go before the request reset)
        trip_ids = list(Trip.objects.filter(
            transport_request__in=active_reqs
        ).values_list('id', flat=True))
        Trip.objects.filter(id__in=trip_ids).delete()
        cancelled = len(trip_ids)

        # Now reset each request back to PENDING on the company (not the driver)
        for req in active_reqs:
            trans = req.transporter
            req.transporter = trans.parent_company if trans.parent_company_id else trans
            req.status = 'PENDING'
            req.vehicle = None
            req.accepted_at = None
            req.save(update_fields=['transporter', 'status', 'vehicle', 'accepted_at'])

        self.stdout.write(f'  Reset {active_reqs.count()} request(s) to PENDING, deleted {cancelled} trip(s).')

        # ── 4. Recreate fresh PENDING requests for both companies ──────────
        coop = Cooperative.objects.filter(name__icontains='Musanze').first()
        if not coop:
            coop = Cooperative.objects.first()

        now = timezone.now()

        demo_requests = [
            # Kalinda Transport Co.
            dict(transporter=kalinda, requested_by_cooperative=coop, leg_number=1,
                 pickup_location='Musanze Collection Point',
                 pickup_gps_lat=-1.499, pickup_gps_lng=29.635,
                 destination='Kigali Nyabugogo Market',
                 destination_gps_lat=-1.938, destination_gps_lng=30.055,
                 cargo_description='Tomatoes — Grade A', estimated_cargo_weight_kg=1200,
                 requires_refrigeration=True,
                 required_pickup_datetime=now + datetime.timedelta(hours=6),
                 status='PENDING'),
            dict(transporter=kalinda, requested_by_cooperative=coop, leg_number=1,
                 pickup_location='Musanze Coop Warehouse',
                 pickup_gps_lat=-1.501, pickup_gps_lng=29.637,
                 destination='Rubavu Gisenyi Market',
                 destination_gps_lat=-1.683, destination_gps_lng=29.341,
                 cargo_description='Potatoes — 1.5 tonnes', estimated_cargo_weight_kg=1500,
                 requires_refrigeration=False,
                 required_pickup_datetime=now + datetime.timedelta(hours=12),
                 status='PENDING'),
            # Gasana Logistics Ltd
            dict(transporter=gasana, requested_by_cooperative=coop, leg_number=1,
                 pickup_location='Musanze Farmers Hub',
                 pickup_gps_lat=-1.497, pickup_gps_lng=29.634,
                 destination='Kigali Kimironko Market',
                 destination_gps_lat=-1.941, destination_gps_lng=30.072,
                 cargo_description='Maize — Bulk', estimated_cargo_weight_kg=2000,
                 requires_refrigeration=False,
                 required_pickup_datetime=now + datetime.timedelta(hours=24),
                 status='PENDING'),
        ]

        # Only create if none already exist
        existing_pending = TransportRequest.objects.filter(
            transporter_id__in=company_ids, status='PENDING'
        ).count()
        if existing_pending == 0:
            for data in demo_requests:
                TransportRequest.objects.create(**data)
            self.stdout.write(f'  Created {len(demo_requests)} fresh PENDING transport requests.')
        else:
            self.stdout.write(f'  {existing_pending} PENDING request(s) already exist — skipped recreation.')

        # ── 5. Recreate pending requests for individual drivers ────────────
        try:
            patrick  = Transporter.objects.get(user__username='driver.mugenzi')
            diane    = Transporter.objects.get(user__username='driver.uwase')
            claudine = Transporter.objects.get(user__username='driver.mutesi')
            # Clear stale pending for these drivers then recreate fresh ones
            TransportRequest.objects.filter(
                transporter__in=[patrick, diane, claudine], status='PENDING'
            ).delete()
            driver_requests = [
                (patrick,  'Kinigi Sector',        -1.474, 29.573, 'Kigali Nyabugogo Market', -1.938, 30.055, 'Tomatoes — cold chain', 850,  True),
                (patrick,  'Musanze Market Hub',    -1.499, 29.635, 'Kimironko Wholesale Market', -1.941, 30.072, 'Irish Potatoes — Grade A', 1450, False),
                (diane,    'Musanze Town Centre',   -1.499, 29.635, 'Huye Open Market',        -2.597, 29.737, 'Potatoes — bulk',       1400, False),
                (claudine, 'Gakenke District Hub',  -1.690, 29.790, 'Kigali Kimironko Market', -1.941, 30.072, 'Avocados — Grade A',    600,  False),
            ]
            for i, (driver, pick, p_lat, p_lng, dest, d_lat, d_lng, cargo, kg, refrig) in enumerate(driver_requests):
                TransportRequest.objects.create(
                    transporter=driver, requested_by_cooperative=coop, leg_number=1,
                    pickup_location=pick, pickup_gps_lat=p_lat, pickup_gps_lng=p_lng,
                    destination=dest, destination_gps_lat=d_lat, destination_gps_lng=d_lng,
                    cargo_description=cargo, estimated_cargo_weight_kg=kg,
                    requires_refrigeration=refrig,
                    required_pickup_datetime=now + datetime.timedelta(hours=8 + i),
                    status='PENDING',
                )
            self.stdout.write(f'  Created {len(driver_requests)} PENDING requests for Patrick (x2), Diane, and Claudine.')
        except Transporter.DoesNotExist:
            pass

        # ── 5b. Give Patrick a pre-accepted multi-stop run, so "Active Trip" shows the
        # per-stop delivery checklist, and Kalinda's Fleet Monitoring has real GPS/
        # temperature/incident telemetry to display, ready to demo without accepting
        # anything live ──
        from apps.iot.models import VehicleIoTReading
        from apps.transport.models import GPSTrack, IncidentReport

        def lerp(a, b, t):
            return round(a + (b - a) * t, 6)

        try:
            import uuid as uuid_lib
            patrick = Transporter.objects.get(user__username='driver.mugenzi')
            already_running = TransportRequest.objects.filter(
                transporter=patrick, run_id__isnull=False,
                status__in=['ACCEPTED', 'IN_PROGRESS'],
            ).exists()
            if not already_running:
                run_id = uuid_lib.uuid4()
                # Last flag on each tuple marks whether that stop's trip runs a temperature
                # breach, so Fleet Monitoring's breach counter/map marker have a real case.
                multi_stops = [
                    ('Musanze Collection Point', -1.499, 29.635, 'Kigali Nyabugogo Market', -1.938, 30.055,
                     'Carrots — mixed crates', 620, False, 1, False),
                    ('Musanze Collection Point', -1.499, 29.635, 'Kimironko Wholesale Market', -1.941, 30.072,
                     'Cabbages — Grade B', 540, False, 2, True),
                ]
                vehicle = Vehicle.objects.filter(transporter=patrick, is_active=True).first()
                pickup_at = now - datetime.timedelta(minutes=30)
                for pick, p_lat, p_lng, dest, d_lat, d_lng, cargo, kg, refrig, seq, breach_demo in multi_stops:
                    req = TransportRequest.objects.create(
                        transporter=patrick, requested_by_cooperative=coop, leg_number=1,
                        run_id=run_id, stop_sequence=seq,
                        pickup_location=pick, pickup_gps_lat=p_lat, pickup_gps_lng=p_lng,
                        destination=dest, destination_gps_lat=d_lat, destination_gps_lng=d_lng,
                        cargo_description=cargo, estimated_cargo_weight_kg=kg,
                        requires_refrigeration=refrig,
                        required_pickup_datetime=now - datetime.timedelta(hours=1),
                        status='ACCEPTED', vehicle=vehicle, accepted_at=now - datetime.timedelta(minutes=45),
                    )
                    trip = Trip.objects.create(
                        transport_request=req,
                        pickup_confirmed_at=pickup_at,
                    )
                    for i, progress in enumerate((0.3, 0.5, 0.7)):
                        GPSTrack.objects.create(
                            trip=trip,
                            latitude=lerp(p_lat, d_lat, progress),
                            longitude=lerp(p_lng, d_lng, progress),
                            speed_kmh=round(38 + i * 4, 1),
                            timestamp=pickup_at + datetime.timedelta(minutes=10 * (i + 1)),
                        )
                    for i in range(3):
                        temp = 9.2 if (breach_demo and i == 2) else round(6.0 + i * 0.4, 1)
                        VehicleIoTReading.objects.create(
                            trip=trip,
                            temperature_celsius=temp,
                            timestamp=pickup_at + datetime.timedelta(minutes=12 * (i + 1)),
                        )
                    if seq == 1:
                        IncidentReport.objects.create(
                            trip=trip, incident_type='FLAT_TIRE',
                            description='Flat tire just outside Musanze — changing now, expect ~20 min delay.',
                            resolved=False,
                        )
                self.stdout.write(
                    '  Created a 2-stop multi-stop run for Patrick with GPS/temperature telemetry '
                    '(one breach) and an open incident — ready in Active Trip / Fleet Monitoring.'
                )
        except Transporter.DoesNotExist:
            pass

        # ── 6. Give Gasana Logistics an active trip too, with the same GPS/temperature/
        # incident telemetry, so its Fleet Monitoring isn't left empty after a reset ──
        try:
            claudine = Transporter.objects.get(user__username='driver.mutesi')
            already_running = TransportRequest.objects.filter(
                transporter=claudine, status__in=['ACCEPTED', 'IN_PROGRESS'],
            ).exists()
            if not already_running:
                pick, p_lat, p_lng = 'Gakenke District Hub', -1.690, 29.790
                dest, d_lat, d_lng = 'Kigali Kimironko Market', -1.941, 30.072
                pickup_at = now - datetime.timedelta(minutes=50)
                req = TransportRequest.objects.create(
                    transporter=claudine, requested_by_cooperative=coop, leg_number=1,
                    pickup_location=pick, pickup_gps_lat=p_lat, pickup_gps_lng=p_lng,
                    destination=dest, destination_gps_lat=d_lat, destination_gps_lng=d_lng,
                    cargo_description='Avocados — cold chain', estimated_cargo_weight_kg=800,
                    requires_refrigeration=True,
                    required_pickup_datetime=now - datetime.timedelta(hours=2),
                    status='ACCEPTED', accepted_at=pickup_at,
                )
                trip = Trip.objects.create(transport_request=req, pickup_confirmed_at=pickup_at)
                for i, progress in enumerate((0.35, 0.55, 0.75)):
                    GPSTrack.objects.create(
                        trip=trip,
                        latitude=lerp(p_lat, d_lat, progress),
                        longitude=lerp(p_lng, d_lng, progress),
                        speed_kmh=round(40 + i * 3, 1),
                        timestamp=pickup_at + datetime.timedelta(minutes=12 * (i + 1)),
                    )
                for i in range(3):
                    VehicleIoTReading.objects.create(
                        trip=trip, temperature_celsius=round(5.5 + i * 0.3, 1),
                        timestamp=pickup_at + datetime.timedelta(minutes=15 * (i + 1)),
                    )
                IncidentReport.objects.create(
                    trip=trip, incident_type='ROAD_CLOSURE',
                    description='Detour near Base due to road works — adding roughly 30 minutes.',
                    resolved=False,
                )
                self.stdout.write(
                    '  Created an active trip for Claudine (Gasana Logistics) with GPS/temperature '
                    'telemetry and an open incident — ready in Fleet Monitoring.'
                )
        except Transporter.DoesNotExist:
            pass

        # ── 7. Ensure produce request filter demo data exists ─────────────
        from apps.distribution.models import ProduceRequest, Distributor
        from apps.cooperatives.models import Cooperative as Coop2
        # Use actual demo distributor accounts, not just first()
        demo_dists = list(Distributor.objects.filter(
            user__email__in=['s.nkurunziza@chainsight.demo', 'e.ingabire@chainsight.demo']
        ))
        dist = demo_dists[0] if demo_dists else Distributor.objects.first()
        if dist:
            demo_coops = list(Coop2.objects.exclude(name__icontains='AUCA').order_by('id')[:3])
            from apps.cooperatives.models import Crop as CropM
            # Only recreate if no DECLINED/COMPLETED/NEGOTIATING/CANCELLED exist
            if not ProduceRequest.objects.filter(
                distributor=dist, status__in=['DECLINED','COMPLETED','NEGOTIATING','CANCELLED']
            ).exists():
                toms = CropM.objects.filter(name='Tomatoes').first()
                beans_c = CropM.objects.filter(name='Beans').first()
                avos = CropM.objects.filter(name='Avocados').first()
                maize_c = CropM.objects.filter(name='Maize').first()
                pots = CropM.objects.filter(name='Potatoes').first()
                if all([toms, beans_c, avos, maize_c, pots]) and len(demo_coops) >= 2:
                    samples = [
                        dict(distributor=dist, cooperative=demo_coops[0], crop=toms,
                             quantity_kg=1200, quality_grade_required='A',
                             required_delivery_date=(now+datetime.timedelta(days=5)).date(),
                             status='DECLINED', cooperative_response_notes='Cooperative could not meet the delivery date.'),
                        dict(distributor=dist, cooperative=demo_coops[1], crop=beans_c,
                             quantity_kg=800, quality_grade_required='B',
                             required_delivery_date=(now+datetime.timedelta(days=10)).date(),
                             status='DECLINED', cooperative_response_notes='Quantity exceeds current stock.'),
                        dict(distributor=dist, cooperative=demo_coops[0], crop=avos,
                             quantity_kg=600, quality_grade_required='A',
                             required_delivery_date=(now+datetime.timedelta(days=14)).date(),
                             status='NEGOTIATING', additional_notes='Discussing adjusted quantity of 500 kg.'),
                        dict(distributor=dist, cooperative=demo_coops[0], crop=maize_c,
                             quantity_kg=2000, quality_grade_required='B',
                             required_delivery_date=(now-datetime.timedelta(days=20)).date(),
                             status='COMPLETED', cooperative_response_notes='Full delivery received and confirmed.'),
                        dict(distributor=dist, cooperative=demo_coops[1], crop=pots,
                             quantity_kg=1500, quality_grade_required='A',
                             required_delivery_date=(now-datetime.timedelta(days=35)).date(),
                             status='COMPLETED', cooperative_response_notes='Completed with 3% transit loss.'),
                        dict(distributor=dist, cooperative=demo_coops[1], crop=avos,
                             quantity_kg=400, quality_grade_required='A',
                             required_delivery_date=(now-datetime.timedelta(days=10)).date(),
                             status='CANCELLED', additional_notes='Cancelled — sourced from alternative cooperative.'),
                    ]
                    for data in samples:
                        ProduceRequest.objects.create(**data)
                    self.stdout.write('  Created 6 demo produce requests (DECLINED/NEGOTIATING/COMPLETED/CANCELLED).')

        # ── 7b. Ensure each cooperative has several PENDING produce requests ──
        # Mirrors the (distributor, crop) combinations seed_demo_data.py creates, so a
        # cooperative manager who accepted/declined some of these during a demo still sees
        # a healthy "pending requests awaiting your response" count on the next reset,
        # not just whatever happened to survive the last session.
        from apps.cooperatives.models import Crop as CropM2

        coop_by_name = {
            'Musanze': Cooperative.objects.filter(name='Musanze Farmers Cooperative').first(),
            'Rubavu':  Cooperative.objects.filter(name='Rubavu Farmers Union').first(),
            'Nyanza':  Cooperative.objects.filter(name='Nyanza Agricultural Cooperative').first(),
            'Kigali':  Cooperative.objects.filter(name='Kigali Urban Farmers Cooperative').first(),
        }
        dist_kigali = Distributor.objects.filter(user__email='s.nkurunziza@chainsight.demo').first()
        dist_north  = Distributor.objects.filter(user__email='e.ingabire@chainsight.demo').first()

        if dist_kigali and dist_north and all(coop_by_name.values()):
            pending_cfg = [
                # (district, distributor, crop_name, qty_kg, grade, days_from_now)
                ('Musanze', dist_kigali, 'Tomatoes', 350, 'A', 14),
                ('Musanze', dist_north,  'Maize',    500, 'B', 21),
                ('Musanze', dist_north,  'Tomatoes', 280, 'B',  9),
                ('Rubavu',  dist_kigali, 'Coffee',   400, 'A', 18),
                ('Rubavu',  dist_north,  'Coffee',   260, 'B',  8),
                ('Rubavu',  dist_kigali, 'Bananas',  320, 'A', 15),
                ('Nyanza',  dist_north,  'Potatoes', 450, 'B', 12),
                ('Nyanza',  dist_kigali, 'Potatoes', 380, 'A', 16),
                ('Nyanza',  dist_north,  'Sweet Potatoes', 300, 'B', 11),
                ('Kigali',  dist_kigali, 'Avocados', 300, 'A', 10),
                ('Kigali',  dist_north,  'Avocados', 220, 'B',  7),
                ('Kigali',  dist_kigali, 'Maize',    500, 'A', 13),
            ]
            topped_up = 0
            for district, dist, crop_name, qty, grade, days in pending_cfg:
                crop = CropM2.objects.filter(name=crop_name).first()
                if not crop:
                    continue
                _, created = ProduceRequest.objects.get_or_create(
                    distributor=dist, cooperative=coop_by_name[district], crop=crop,
                    status='PENDING',
                    defaults=dict(
                        quantity_kg=qty,
                        quality_grade_required=grade,
                        required_delivery_date=(now + datetime.timedelta(days=days)).date(),
                        additional_notes='',
                    ),
                )
                if created:
                    topped_up += 1
            if topped_up:
                self.stdout.write(f'  Topped up {topped_up} pending produce request(s) back to the full demo set.')

        # ── 8. Reset warehouse rental requests ────────────────────────────
        from apps.cooperatives.models import ColdStorageFacility, WarehouseRentalRequest, Cooperative

        # Reset accepted/declined rental requests back to PENDING
        accepted_rentals = WarehouseRentalRequest.objects.filter(status__in=['ACCEPTED', 'DECLINED'])
        accepted_rentals.update(status='PENDING', decline_reason='', responded_at=None)
        self.stdout.write(f'  Reset {accepted_rentals.count()} rental request(s) back to PENDING.')

        # Ensure at least 4 PENDING rental requests exist
        pending_rentals = WarehouseRentalRequest.objects.filter(status='PENDING').count()
        if pending_rentals < 4:
            fac1 = ColdStorageFacility.objects.filter(id=112).first()
            fac2 = ColdStorageFacility.objects.filter(id=113).first()
            demo_coops = list(Cooperative.objects.exclude(name__startswith='AUCA').order_by('id')[:3])
            if fac1 and fac2 and demo_coops:
                WarehouseRentalRequest.objects.filter(status='PENDING').delete()
                rental_data = [
                    (demo_coops[0], fac1, 500, 'Cold storage for tomato harvest — refrigeration needed.'),
                    (demo_coops[0], fac2, 800, 'Potato storage ahead of market season.'),
                    (demo_coops[1] if len(demo_coops) > 1 else demo_coops[0], fac1, 300, 'Avocado cold storage — Grade A export preparation.'),
                    (demo_coops[2] if len(demo_coops) > 2 else demo_coops[0], fac2, 1000, 'Emergency storage — recent harvest surplus.'),
                ]
                for c, f, kg, note in rental_data:
                    WarehouseRentalRequest.objects.create(cooperative=c, facility=f,
                        requested_capacity_kg=kg, notes=note, status='PENDING')
                self.stdout.write('  Created 4 fresh PENDING warehouse rental requests.')

        # ── 9. Reactivate any suspended demo drivers, resolve back any incidents ──
        from apps.transport.models import IncidentReport
        reactivated = Transporter.objects.filter(
            id__in=driver_ids, is_active=False
        ).update(is_active=True)
        if reactivated:
            self.stdout.write(f'  Reactivated {reactivated} suspended demo driver(s).')

        reopened = IncidentReport.objects.filter(
            trip__transport_request__transporter_id__in=all_transporter_ids, resolved=True
        ).update(resolved=False)
        if reopened:
            self.stdout.write(f'  Re-opened {reopened} incident(s) back to unresolved.')

        # ── 10. Keep "today" non-empty for reports, for WHICHEVER account is used ──
        # Seed data is created in one-off batches on whatever date it was seeded, so a
        # "Today"/"This week" report filter comes back empty on any day that isn't the
        # seeding date. Bumping just a few of the globally-most-recent records (the old
        # approach) mostly missed whichever specific account you actually log in with —
        # this instead bumps the most recent record PER OWNING ACCOUNT (per distributor,
        # per cooperative, per market agent, per warehouse manager), so any demo account
        # with any history at all gets at least one "today" record. A record dated today
        # satisfies Today/This week/This month/Last 30 days simultaneously, since all of
        # those ranges include today.
        from apps.distribution.models import Order, ProduceRequest
        from apps.market_agents.models import CollectionConfirmation
        from apps.traceability.models import Batch
        from apps.cooperatives.models import WarehouseRentalRequest

        def bump_latest_per_account(qs, group_field, date_field, minutes_apart=6):
            ids = list(
                qs.order_by(group_field, f'-{date_field}')
                  .distinct(group_field)
                  .values_list('id', flat=True)
            )
            for i, obj_id in enumerate(ids):
                qs.model.objects.filter(id=obj_id).update(
                    **{date_field: now - datetime.timedelta(minutes=i * minutes_apart)}
                )
            return len(ids)

        touched = 0
        # Only touch records still in their initial state (no confirmed_at/responded_at/etc.
        # set yet), so bumping the timestamp forward can't land it after a later,
        # already-past stage (e.g. "confirmed" before "created").
        # NOTE: group by the raw "<field>_id" column, not the bare FK field name — Django
        # expands a bare FK field in order_by()/distinct() into the *related model's*
        # Meta.ordering fields (e.g. market agent's stall name), which breaks Postgres'
        # requirement that DISTINCT ON columns exactly match the leading ORDER BY columns.
        touched += bump_latest_per_account(
            Order.objects.filter(status='PENDING_CONFIRMATION', confirmed_at__isnull=True),
            'distributor_id', 'created_at',
        )
        touched += bump_latest_per_account(
            ProduceRequest.objects.filter(status='PENDING', responded_at__isnull=True),
            'distributor_id', 'created_at',
        )
        touched += bump_latest_per_account(
            CollectionConfirmation.objects.all(), 'market_agent_id', 'collected_at',
        )
        # Only batches with no downstream timestamp yet, so bumping one stage forward can
        # never land it after a later stage still sitting in the past.
        touched += bump_latest_per_account(
            Batch.objects.filter(current_status__in=['AT_COOPERATIVE', 'IN_TRANSIT_LEG1']),
            'cooperative_id', 'dispatch_timestamp',
        )
        touched += bump_latest_per_account(
            Batch.objects.filter(current_status='AT_DISTRIBUTOR'),
            'received_by_distributor_id', 'distributor_receipt_timestamp',
        )
        touched += bump_latest_per_account(
            WarehouseRentalRequest.objects.filter(status='PENDING'),
            'facility__warehouse_manager_id', 'created_at',
        )
        if touched:
            self.stdout.write(f'  Refreshed {touched} record timestamp(s) to today, one per account, so "Today"/"This week" report filters have data no matter which demo account you use.')

        self.stdout.write(self.style.SUCCESS('\nDEMO STATE RESET. Ready for presentation!\n'))

        # ── Summary ────────────────────────────────────────────────────────
        self.stdout.write('TRANSPORT:')
        for company in [kalinda, gasana]:
            drivers = Transporter.objects.filter(parent_company=company)
            pending = TransportRequest.objects.filter(transporter=company, status='PENDING').count()
            self.stdout.write(f'  {company.company_name} — {pending} pending request(s), {drivers.count()} driver(s)')
        driver_pending = TransportRequest.objects.filter(
            transporter__in=Transporter.objects.filter(user__username__in=['driver.mugenzi','driver.uwase','driver.mutesi']),
            status='PENDING'
        ).count()
        self.stdout.write(f'  Individual drivers — {driver_pending} pending request(s)')

        self.stdout.write('WAREHOUSE:')
        rental_total = WarehouseRentalRequest.objects.filter(status='PENDING').count()
        self.stdout.write(f'  {rental_total} PENDING rental request(s) for warehouse manager to review')
