"""
Management command: seed_demo_data
Usage: python manage.py seed_demo_data [--reset]

Seeds the database with 6 months of realistic Rwandan agricultural data
so every ChainSight dashboard, chart, and report shows meaningful numbers
during a supervisor demo.

Creates: 4 cooperatives · 2 transporters · 2 distributors · 3 market agents
         1 MINAGRI officer · 1 admin · 48 batches (6 months × 4 districts)
         transport trips · orders · collection confirmations · waste reports
"""

import random
import uuid
from datetime import date, timedelta, datetime

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

DEMO_PASSWORD = 'Demo1234!'
random.seed(42)  # reproducible data


def rnd(lo, hi):
    return round(random.uniform(lo, hi), 2)


# ── Crop master data ─────────────────────────────────────────────────────────

CROPS = [
    # (name, category, cold_chain, amber_hrs, red_hrs, amber_temp, red_temp)
    ('Tomatoes',       'PERISHABLE',  True,   4.0,  8.0, 25.0, 30.0),
    ('Maize',          'DRY_GOODS',   False, 48.0, 96.0, None, None),
    ('Coffee',         'DRY_GOODS',   False, 72.0, 144.0, None, None),
    ('Bananas',        'FRUITS',      False,  6.0, 12.0, 28.0, 33.0),
    ('Potatoes',       'ROOT_TUBERS', False, 24.0, 72.0, None, None),
    ('Sweet Potatoes', 'ROOT_TUBERS', False, 24.0, 72.0, None, None),
    ('Avocados',       'FRUITS',      False,  8.0, 16.0, 22.0, 28.0),
    ('Sorghum',        'DRY_GOODS',   False, 48.0, 96.0, None, None),
]

# ── District configuration ───────────────────────────────────────────────────

DISTRICT_CFG = {
    'Musanze': {
        'coop_name': 'Musanze Farmers Cooperative',
        'reg_no':    'RCA/MUS/2019/001',
        'sector':    'Kinigi',
        'crop_names': ['Tomatoes', 'Maize'],
        'transit_loss': (9.0, 14.0),
        'market_loss':  (5.0,  7.5),
        'transit_hrs':  (3.5,  5.5),
        'pickup_loc':   'Musanze Market Hub, Northern Province',
        'gps': (-1.4996, 29.6342),
        'manager': {
            'username': 'coop.musanze', 'first_name': 'Jean',
            'last_name': 'Habimana', 'phone': '+250788100001',
            'email': 'j.habimana@chainsight.demo',
        },
    },
    'Rubavu': {
        'coop_name': 'Rubavu Farmers Union',
        'reg_no':    'RCA/RUB/2020/007',
        'sector':    'Gisenyi',
        'crop_names': ['Coffee', 'Bananas'],
        'transit_loss': (7.0, 11.0),   # MEDIUM-HIGH
        'market_loss':  (4.0,  6.5),
        'transit_hrs':  (4.0,  6.0),
        'pickup_loc':   'Rubavu Produce Center, Western Province',
        'gps': (-1.7005, 29.2565),
        'manager': {
            'username': 'coop.rubavu', 'first_name': 'Immaculée',
            'last_name': 'Mukamana', 'phone': '+250788100002',
            'email': 'i.mukamana@chainsight.demo',
        },
    },
    'Nyanza': {
        'coop_name': 'Nyanza Agricultural Cooperative',
        'reg_no':    'RCA/NYA/2018/003',
        'sector':    'Busasamana',
        'crop_names': ['Potatoes', 'Sweet Potatoes'],
        'transit_loss': (4.0,  7.5),   # MEDIUM
        'market_loss':  (3.0,  5.5),
        'transit_hrs':  (2.0,  3.5),
        'pickup_loc':   'Nyanza Collection Point, Southern Province',
        'gps': (-2.3527, 29.7497),
        'manager': {
            'username': 'coop.nyanza', 'first_name': 'Marie Claire',
            'last_name': 'Uwimana', 'phone': '+250788100003',
            'email': 'mc.uwimana@chainsight.demo',
        },
    },
    'Kigali': {
        'coop_name': 'Kigali Urban Farmers Cooperative',
        'reg_no':    'RCA/KGL/2021/012',
        'sector':    'Nyarugenge',
        'crop_names': ['Avocados', 'Maize'],
        'transit_loss': (2.0,  5.0),   # LOW — short urban transit
        'market_loss':  (2.0,  3.5),
        'transit_hrs':  (1.5,  2.5),
        'pickup_loc':   'Kigali Farm Hub, Nyarugenge District',
        'gps': (-1.9441, 30.0619),
        'manager': {
            'username': 'coop.kigali', 'first_name': 'Patrick',
            'last_name': 'Habimana', 'phone': '+250788100004',
            'email': 'p.habimana@chainsight.demo',
        },
    },
}

# ── Monthly loss multipliers (trend: improving then slight uptick) ───────────
# index 0 = December 2025, index 5 = May 2026
MONTH_MULTIPLIERS = [1.18, 1.10, 1.05, 0.96, 0.90, 0.97]

MONTHS = [
    (2025, 12), (2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5),
]


class Command(BaseCommand):
    help = 'Seeds ChainSight with 6 months of realistic demo data for supervisor presentation'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset', action='store_true',
            help='Delete existing demo data before re-seeding',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.authentication.models import User
        from apps.cooperatives.models import Crop

        if options['reset']:
            self._reset()

        if User.objects.filter(username='demo.admin').exists():
            self.stdout.write(self.style.WARNING(
                'Demo data already exists. Run with --reset to clear and re-seed.'
            ))
            return

        self.stdout.write(self.style.MIGRATE_HEADING(
            '\nSeeding ChainSight demo data for supervisor presentation...\n'
        ))

        crops        = self._seed_crops()
        users        = self._seed_special_users()
        coops        = self._seed_cooperatives(crops)
        transporters = self._seed_transporters(coops)
        distributors = self._seed_distributors()
        agents       = self._seed_market_agents()
        self._seed_batches(coops, transporters, distributors, agents, crops)
        self._seed_storage_facilities(coops)
        self._seed_pending_requests(coops, distributors, crops)
        self._seed_warehouse_manager(coops)
        self._seed_ai_insights()
        self._seed_access_requests()

        self.stdout.write(self.style.SUCCESS('\nDemo data seeded successfully!\n'))
        self._print_credentials()

    # ── Reset ────────────────────────────────────────────────────────────────

    def _reset(self):
        from apps.authentication.models import User
        from apps.market_agents.models import WasteReport, CollectionConfirmation, MarketAgent
        from apps.distribution.models import Order, CollectionNotice, SupplyAgreement, ProduceRequest, Distributor, DistributorMarketAgentLink
        from apps.traceability.models import Batch
        from apps.transport.models import Trip, TransportRequest, Vehicle, Transporter
        from apps.cooperatives.models import (
            CooperativeStock, Cooperative, ColdStorageFacility,
            WarehouseManager, WarehouseRentalRequest,
        )
        from apps.iot.models import IoTReading
        from apps.ai_insights.models import AIInsight, DailyBriefBundle
        from apps.authentication.models import AccessRequest

        # National-level, not tied to any one demo user — clear on every reset.
        DailyBriefBundle.objects.all().delete()
        AIInsight.objects.all().delete()
        AccessRequest.objects.filter(email__endswith='@applicant.demo').delete()

        demo_usernames = (
            ['demo.admin', 'demo.minagri', 'wh.mugisha'] +
            [cfg['manager']['username'] for cfg in DISTRICT_CFG.values()] +
            ['trans.kalinda', 'trans.gasana', 'dist.kigali', 'dist.north',
             'agent.kimironko', 'agent.nyabugogo', 'agent.remera']
        )
        self.stdout.write('  Removing existing demo data...')
        # Delete in dependency order (deepest first)
        IoTReading.objects.filter(facility__cooperative__manager__username__in=demo_usernames).delete()
        IoTReading.objects.filter(facility__warehouse_manager__user__username__in=demo_usernames).delete()
        WarehouseRentalRequest.objects.filter(facility__warehouse_manager__user__username__in=demo_usernames).delete()
        ColdStorageFacility.objects.filter(warehouse_manager__user__username__in=demo_usernames).delete()
        WarehouseManager.objects.filter(user__username__in=demo_usernames).delete()
        ColdStorageFacility.objects.filter(cooperative__manager__username__in=demo_usernames).delete()
        WasteReport.objects.filter(market_agent__user__username__in=demo_usernames).delete()
        CollectionConfirmation.objects.filter(market_agent__user__username__in=demo_usernames).delete()
        Order.objects.filter(distributor__user__username__in=demo_usernames).delete()
        CollectionNotice.objects.filter(distributor__user__username__in=demo_usernames).delete()
        # Batch.supply_agreement is a protected FK — batches must go before the SupplyAgreement/
        # ProduceRequest chain they may reference.
        Batch.objects.filter(cooperative__manager__username__in=demo_usernames).delete()
        SupplyAgreement.objects.filter(produce_request__distributor__user__username__in=demo_usernames).delete()
        SupplyAgreement.objects.filter(produce_request__cooperative__manager__username__in=demo_usernames).delete()
        ProduceRequest.objects.filter(distributor__user__username__in=demo_usernames).delete()
        ProduceRequest.objects.filter(cooperative__manager__username__in=demo_usernames).delete()
        Trip.objects.filter(transport_request__transporter__user__username__in=demo_usernames).delete()
        Trip.objects.filter(transport_request__requested_by_cooperative__manager__username__in=demo_usernames).delete()
        Trip.objects.filter(transport_request__requested_by_distributor__user__username__in=demo_usernames).delete()
        TransportRequest.objects.filter(transporter__user__username__in=demo_usernames).delete()
        TransportRequest.objects.filter(requested_by_cooperative__manager__username__in=demo_usernames).delete()
        Vehicle.objects.filter(transporter__user__username__in=demo_usernames).delete()
        Transporter.objects.filter(user__username__in=demo_usernames).delete()
        DistributorMarketAgentLink.objects.filter(distributor__user__username__in=demo_usernames).delete()
        DistributorMarketAgentLink.objects.filter(market_agent__user__username__in=demo_usernames).delete()
        CooperativeStock.objects.filter(cooperative__manager__username__in=demo_usernames).delete()
        Cooperative.objects.filter(manager__username__in=demo_usernames).delete()
        # Delete profile objects before their protected User FK
        Distributor.objects.filter(user__username__in=demo_usernames).delete()
        MarketAgent.objects.filter(user__username__in=demo_usernames).delete()
        User.objects.filter(username__in=demo_usernames).delete()

    # ── Crops ────────────────────────────────────────────────────────────────

    def _seed_crops(self):
        from apps.cooperatives.models import Crop
        self.stdout.write('  Seeding crops...')
        crop_map = {}
        for name, cat, cold, a_hrs, r_hrs, a_temp, r_temp in CROPS:
            crop, _ = Crop.objects.get_or_create(
                name=name,
                defaults=dict(
                    category=cat,
                    requires_cold_chain=cold,
                    safe_transit_hours_amber=a_hrs,
                    safe_transit_hours_red=r_hrs,
                    safe_temp_max_amber=a_temp,
                    safe_temp_max_red=r_temp,
                ),
            )
            crop_map[name] = crop
        self.stdout.write(f'    {len(crop_map)} crops ready')
        return crop_map

    # ── Special users (admin + MINAGRI) ─────────────────────────────────────

    def _seed_special_users(self):
        from apps.authentication.models import User
        self.stdout.write('  Seeding admin & MINAGRI users...')
        users = {}

        admin, _ = User.objects.get_or_create(
            username='demo.admin',
            defaults=dict(
                first_name='System', last_name='Administrator',
                email='admin@chainsight.demo',
                role='ADMIN', phone_number='+250788000001',
                organization_name='MINAGRI / ChainSight',
                is_verified=True, must_change_password=False,
                is_staff=True, is_superuser=True,
            ),
        )
        admin.set_password(DEMO_PASSWORD)
        admin.save()
        users['admin'] = admin

        minagri, _ = User.objects.get_or_create(
            username='demo.minagri',
            defaults=dict(
                first_name='Claudine', last_name='Nzeyimana',
                email='c.nzeyimana@minagri.demo',
                role='MINAGRI_OFFICER', phone_number='+250788000002',
                organization_name='MINAGRI',
                is_verified=True, must_change_password=False,
            ),
        )
        minagri.set_password(DEMO_PASSWORD)
        minagri.save()
        users['minagri'] = minagri

        return users

    # ── Cooperatives ─────────────────────────────────────────────────────────

    def _seed_cooperatives(self, crops):
        from apps.authentication.models import User
        from apps.cooperatives.models import Cooperative, CooperativeStock
        self.stdout.write('  Seeding cooperatives...')
        coop_map = {}

        for district, cfg in DISTRICT_CFG.items():
            m = cfg['manager']
            mgr, _ = User.objects.get_or_create(
                username=m['username'],
                defaults=dict(
                    first_name=m['first_name'], last_name=m['last_name'],
                    email=m['email'], phone_number=m['phone'],
                    role='COOPERATIVE_MANAGER',
                    organization_name=cfg['coop_name'],
                    district=district,
                    is_verified=True, must_change_password=False,
                ),
            )
            mgr.set_password(DEMO_PASSWORD)
            mgr.save()

            coop, created = Cooperative.objects.get_or_create(
                registration_number=cfg['reg_no'],
                defaults=dict(
                    manager=mgr,
                    name=cfg['coop_name'],
                    district=district,
                    sector=cfg['sector'],
                    gps_latitude=cfg['gps'][0],
                    gps_longitude=cfg['gps'][1],
                    contact_phone=m['phone'],
                    contact_email=m['email'],
                    reliability_score=round(random.uniform(3.5, 4.8), 2),
                    on_time_dispatch_rate=round(random.uniform(78, 96), 2),
                    quality_consistency_rate=round(random.uniform(80, 95), 2),
                    total_batches_dispatched=random.randint(40, 120),
                ),
            )
            if not created:
                coop.manager = mgr
                coop.reliability_score = round(random.uniform(3.5, 4.8), 2)
                coop.on_time_dispatch_rate = round(random.uniform(78, 96), 2)
                coop.quality_consistency_rate = round(random.uniform(80, 95), 2)
                coop.total_batches_dispatched = random.randint(40, 120)
                coop.save()
            coop.crops_specialised.set([crops[n] for n in cfg['crop_names'] if n in crops])
            coop_map[district] = (coop, mgr)

            # Stock records
            for crop_name in cfg['crop_names']:
                if crop_name in crops:
                    stock, created = CooperativeStock.objects.get_or_create(
                        cooperative=coop,
                        crop=crops[crop_name],
                        defaults=dict(
                            quantity_kg=round(random.uniform(200, 700), 2),
                            quality_grade=random.choice(['A', 'A', 'B']),
                            harvest_date=date(2026, 6, 1),
                            available_from=date(2026, 6, 5),
                            is_available=True,
                        ),
                    )
                    if not created:
                        stock.quantity_kg = round(random.uniform(200, 700), 2)
                        stock.is_available = True
                        stock.harvest_date = date(2026, 6, 1)
                        stock.available_from = date(2026, 6, 5)
                        stock.save()

        self.stdout.write(f'    {len(coop_map)} cooperatives ready')
        return coop_map

    # ── Transporters ─────────────────────────────────────────────────────────

    def _seed_transporters(self, coops):
        from apps.authentication.models import User
        from apps.transport.models import Transporter, Vehicle
        self.stdout.write('  Seeding transporters...')

        trans_data = [
            {
                'username': 'trans.kalinda', 'first_name': 'Alain', 'last_name': 'Kalinda',
                'phone': '+250788200001', 'email': 'a.kalinda@chainsight.demo',
                'company': 'Kalinda Transport Co.', 'districts': ['Musanze', 'Rubavu', 'Kigali'],
                'plates': [('RAD 781 A', 'STANDARD_TRUCK', 5000), ('RAD 203 B', 'REFRIGERATED', 3000)],
                'reg_coop': 'Musanze',
                'drivers': [
                    {'username': 'driver.mugenzi', 'first_name': 'Patrick', 'last_name': 'Mugenzi',
                     'phone': '+250788200011', 'email': 'p.mugenzi@chainsight.demo'},
                    {'username': 'driver.uwase', 'first_name': 'Diane', 'last_name': 'Uwase',
                     'phone': '+250788200012', 'email': 'd.uwase@chainsight.demo'},
                ],
            },
            {
                'username': 'trans.gasana', 'first_name': 'Eric', 'last_name': 'Gasana',
                'phone': '+250788200002', 'email': 'e.gasana@chainsight.demo',
                'company': 'Gasana Logistics Ltd', 'districts': ['Nyanza', 'Kigali'],
                'plates': [('RAD 554 C', 'PICKUP', 2000)],
                'reg_coop': 'Nyanza',
                'drivers': [
                    {'username': 'driver.mutesi', 'first_name': 'Claudine', 'last_name': 'Mutesi',
                     'phone': '+250788200021', 'email': 'c.mutesi@chainsight.demo'},
                ],
            },
        ]

        trans_map = {}
        driver_count = 0
        for td in trans_data:
            user, _ = User.objects.get_or_create(
                username=td['username'],
                defaults=dict(
                    first_name=td['first_name'], last_name=td['last_name'],
                    email=td['email'], phone_number=td['phone'],
                    role='TRANSPORT_COMPANY', organization_name=td['company'],
                    is_verified=True, must_change_password=False,
                ),
            )
            user.set_password(DEMO_PASSWORD)
            user.save()

            reg_coop = coops[td['reg_coop']][0] if td['reg_coop'] in coops else None
            trans, _ = Transporter.objects.get_or_create(
                user=user,
                defaults=dict(
                    company_name=td['company'],
                    operating_districts=td['districts'],
                    registered_by_cooperative=reg_coop,
                ),
            )
            for plate, vtype, cap in td['plates']:
                Vehicle.objects.get_or_create(
                    plate_number=plate,
                    defaults=dict(
                        transporter=trans, vehicle_type=vtype,
                        capacity_kg=cap, operating_districts=td['districts'],
                    ),
                )
            trans_map[td['username']] = trans

            # Individual drivers registered by this Transport Company — each gets their own
            # real login, distinct from the company's. Mirrors the "My Fleet → Register
            # Driver" flow exactly, just seeded instead of done through the UI.
            for dd in td.get('drivers', []):
                d_user, _ = User.objects.get_or_create(
                    username=dd['username'],
                    defaults=dict(
                        first_name=dd['first_name'], last_name=dd['last_name'],
                        email=dd['email'], phone_number=dd['phone'],
                        role='TRANSPORTER', is_verified=True, must_change_password=False,
                    ),
                )
                d_user.set_password(DEMO_PASSWORD)
                d_user.save()
                Transporter.objects.get_or_create(
                    user=d_user,
                    defaults=dict(
                        operating_districts=td['districts'],
                        parent_company=trans,
                    ),
                )
                driver_count += 1

        self.stdout.write(f'    {len(trans_map)} transport companies + {driver_count} drivers ready')
        return trans_map

    # ── Distributors ─────────────────────────────────────────────────────────

    def _seed_distributors(self):
        from apps.authentication.models import User
        from apps.distribution.models import Distributor
        self.stdout.write('  Seeding distributors...')

        dist_data = [
            {
                'username': 'dist.kigali', 'first_name': 'Samuel', 'last_name': 'Nkurunziza',
                'phone': '+250788300001', 'email': 's.nkurunziza@chainsight.demo',
                'company': 'Kigali Fresh Distributors Ltd',
                'warehouse': 'Kimironko Wholesale Market, Kigali',
                'district': 'Kigali', 'gps': (-1.9506, 30.1044),
            },
            {
                'username': 'dist.north', 'first_name': 'Esperance', 'last_name': 'Ingabire',
                'phone': '+250788300002', 'email': 'e.ingabire@chainsight.demo',
                'company': 'Northern Rwanda Distributors',
                'warehouse': 'Nyabugogo Trade Hub, Kigali',
                'district': 'Kigali', 'gps': (-1.9347, 30.0586),
            },
        ]

        dist_map = {}
        for dd in dist_data:
            user, _ = User.objects.get_or_create(
                username=dd['username'],
                defaults=dict(
                    first_name=dd['first_name'], last_name=dd['last_name'],
                    email=dd['email'], phone_number=dd['phone'],
                    role='DISTRIBUTOR', organization_name=dd['company'],
                    is_verified=True, must_change_password=False,
                ),
            )
            user.set_password(DEMO_PASSWORD)
            user.save()

            dist, _ = Distributor.objects.get_or_create(
                user=user,
                defaults=dict(
                    company_name=dd['company'],
                    warehouse_location=dd['warehouse'],
                    warehouse_gps_lat=dd['gps'][0],
                    warehouse_gps_lng=dd['gps'][1],
                    district=dd['district'],
                    contact_phone=dd['phone'],
                ),
            )
            dist_map[dd['username']] = dist

        self.stdout.write(f'    {len(dist_map)} distributors ready')
        return dist_map

    # ── Market Agents ────────────────────────────────────────────────────────

    def _seed_market_agents(self):
        from apps.authentication.models import User
        from apps.market_agents.models import MarketAgent
        self.stdout.write('  Seeding market agents...')

        agent_data = [
            {
                'username': 'agent.kimironko', 'first_name': 'Grace', 'last_name': 'Uwera',
                'phone': '+250788400001', 'email': 'g.uwera@chainsight.demo',
                'stall': 'A-12', 'market': 'Kimironko Market', 'district': 'Kigali',
            },
            {
                'username': 'agent.nyabugogo', 'first_name': 'Emmanuel', 'last_name': 'Nshimiyimana',
                'phone': '+250788400002', 'email': 'e.nshimiyimana@chainsight.demo',
                'stall': 'B-07', 'market': 'Nyabugogo Market', 'district': 'Kigali',
            },
            {
                'username': 'agent.remera', 'first_name': 'Diane', 'last_name': 'Mukankusi',
                'phone': '+250788400003', 'email': 'd.mukankusi@chainsight.demo',
                'stall': 'C-03', 'market': 'Remera Vegetables Market', 'district': 'Kigali',
            },
        ]

        agent_map = {}
        for ad in agent_data:
            user, _ = User.objects.get_or_create(
                username=ad['username'],
                defaults=dict(
                    first_name=ad['first_name'], last_name=ad['last_name'],
                    email=ad['email'], phone_number=ad['phone'],
                    role='MARKET_AGENT', organization_name=ad['market'],
                    is_verified=True, must_change_password=False,
                ),
            )
            user.set_password(DEMO_PASSWORD)
            user.save()

            agent, _ = MarketAgent.objects.get_or_create(
                user=user,
                defaults=dict(
                    stall_number=ad['stall'], market_name=ad['market'],
                    market_district=ad['district'],
                ),
            )
            agent_map[ad['username']] = agent

        # Link all agents to both distributors
        from apps.distribution.models import DistributorMarketAgentLink, Distributor
        for dist in Distributor.objects.filter(user__username__in=['dist.kigali', 'dist.north']):
            for agent in agent_map.values():
                DistributorMarketAgentLink.objects.get_or_create(
                    distributor=dist, market_agent=agent,
                )

        self.stdout.write(f'    {len(agent_map)} market agents ready')
        return agent_map

    # ── Batches (core demo data) ─────────────────────────────────────────────

    def _seed_batches(self, coops, transporters, distributors, agents, crops):
        from apps.traceability.models import Batch
        from apps.transport.models import TransportRequest, Trip, Vehicle, GPSTrack
        from apps.distribution.models import (
            Distributor, CollectionNotice, Order, ProduceRequest, SupplyAgreement,
        )
        from apps.market_agents.models import CollectionConfirmation, WasteReport
        from apps.iot.models import VehicleIoTReading

        self.stdout.write('  Seeding batches, trips, orders, and waste reports...')

        dist_list  = list(distributors.values())
        trans_list = list(transporters.values())
        agent_list = list(agents.values())
        batch_count = 0

        for month_idx, (year, month) in enumerate(MONTHS):
            loss_mul = MONTH_MULTIPLIERS[month_idx]

            for district, cfg in DISTRICT_CFG.items():
                coop, mgr = coops[district]

                for batch_num in range(2):  # 2 batches per district per month
                    day = 5 + batch_num * 10 + random.randint(0, 4)
                    try:
                        dispatch_dt = timezone.make_aware(
                            datetime(year, month, min(day, 28), random.randint(6, 10), 0, 0)
                        )
                    except ValueError:
                        continue

                    crop_name = cfg['crop_names'][batch_num % len(cfg['crop_names'])]
                    crop = crops.get(crop_name)
                    if not crop:
                        continue

                    dispatch_kg = round(random.uniform(200, 800), 2)
                    grade = random.choices(['A', 'A', 'B', 'B', 'C'], weights=[3, 3, 3, 2, 1])[0]

                    # Loss rates for this district × month
                    t_lo, t_hi = cfg['transit_loss']
                    m_lo, m_hi = cfg['market_loss']
                    transit_pct = rnd(t_lo * loss_mul, t_hi * loss_mul)
                    market_pct  = rnd(m_lo * loss_mul, m_hi * loss_mul)

                    transit_loss_kg = round(dispatch_kg * transit_pct / 100, 2)
                    weight_at_dist  = round(dispatch_kg - transit_loss_kg, 2)
                    market_loss_kg  = round(weight_at_dist * market_pct / 100, 2)
                    total_loss_kg   = round(transit_loss_kg + market_loss_kg, 2)
                    total_loss_pct  = round(total_loss_kg / dispatch_kg * 100, 2)

                    transit_hrs = rnd(*cfg['transit_hrs'])
                    dist_receipt_dt = dispatch_dt + timedelta(hours=transit_hrs + 1)
                    trans = random.choice(trans_list)
                    dist  = random.choice(dist_list)
                    agent = random.choice(agent_list)

                    # Determine status — last month's batches stay in progress, so there's
                    # always a healthy spread of live in-transit batches (GPS + IoT) to demo,
                    # not just a single one.
                    is_completed = not (month_idx == 5)

                    # TransportRequest (leg 1)
                    tr = TransportRequest.objects.create(
                        requested_by_cooperative=coop,
                        transporter=trans,
                        leg_number=1,
                        pickup_location=cfg['pickup_loc'],
                        pickup_gps_lat=cfg['gps'][0],
                        pickup_gps_lng=cfg['gps'][1],
                        destination=f"{dist.warehouse_location}",
                        destination_gps_lat=dist.warehouse_gps_lat,
                        destination_gps_lng=dist.warehouse_gps_lng,
                        cargo_description=f"{crop_name} — Grade {grade}",
                        estimated_cargo_weight_kg=dispatch_kg,
                        requires_refrigeration=crop.requires_cold_chain,
                        required_pickup_datetime=dispatch_dt + timedelta(hours=1),
                        status='COMPLETED' if is_completed else 'IN_PROGRESS',
                        accepted_at=dispatch_dt + timedelta(minutes=30),
                    )

                    # Real dispatch flow always ties a Batch to a SupplyAgreement (the
                    # distributor must have requested it first) — without this, the
                    # distributor's own batch list can't see the batch at all, since
                    # BatchViewSet scopes distributor visibility through this link.
                    pr = ProduceRequest.objects.create(
                        distributor=dist, cooperative=coop, crop=crop,
                        quantity_kg=dispatch_kg, quality_grade_required=grade,
                        required_delivery_date=dispatch_dt.date(),
                        status='ACCEPTED', responded_at=dispatch_dt - timedelta(days=1),
                    )
                    sa = SupplyAgreement.objects.create(
                        produce_request=pr, agreed_quantity_kg=dispatch_kg,
                        agreed_quality_grade=grade, agreed_delivery_date=dispatch_dt.date(),
                    )

                    # Batch
                    batch = Batch.objects.create(
                        cooperative=coop,
                        crop=crop,
                        supply_agreement=sa,
                        dispatched_by=mgr,
                        dispatch_weight_kg=dispatch_kg,
                        quality_grade_at_dispatch=grade,
                        dispatch_timestamp=dispatch_dt,
                        transport_request_leg1=tr,
                        received_by_distributor=dist if is_completed else None,
                        weight_at_distributor_kg=weight_at_dist if is_completed else None,
                        quality_at_distributor=grade if is_completed else '',
                        distributor_receipt_timestamp=dist_receipt_dt if is_completed else None,
                        transit_loss_leg1_kg=transit_loss_kg if is_completed else None,
                        transit_loss_leg1_pct=round(transit_pct, 2) if is_completed else None,
                        market_spoilage_loss_kg=market_loss_kg if is_completed else None,
                        market_spoilage_loss_pct=round(market_pct, 2) if is_completed else None,
                        total_loss_kg=total_loss_kg if is_completed else None,
                        total_loss_pct=total_loss_pct if is_completed else None,
                        current_status='COMPLETED' if is_completed else 'IN_TRANSIT_LEG1',
                    )

                    if is_completed:
                        # Trip record
                        actual_pickup = dispatch_dt + timedelta(hours=1, minutes=random.randint(0, 30))
                        actual_delivery = actual_pickup + timedelta(hours=transit_hrs)
                        Trip.objects.create(
                            transport_request=tr,
                            actual_pickup_datetime=actual_pickup,
                            actual_delivery_datetime=actual_delivery,
                            pickup_confirmed_at=actual_pickup,
                            delivery_confirmed_at=actual_delivery,
                        )

                        # CollectionNotice → Order → CollectionConfirmation → WasteReport
                        notice = CollectionNotice.objects.create(
                            distributor=dist,
                            crop=crop,
                            available_quantity_kg=weight_at_dist,
                            collection_deadline=dist_receipt_dt + timedelta(days=3),
                            pickup_location=dist.warehouse_location,
                        )

                        order = Order.objects.create(
                            collection_notice=notice,
                            market_agent=agent,
                            distributor=dist,
                            quantity_requested_kg=weight_at_dist,
                            confirmed_quantity_kg=weight_at_dist,
                            delivery_method='SELF_COLLECTION',
                            status='COMPLETED',
                            confirmed_at=dist_receipt_dt + timedelta(hours=2),
                        )
                        batch.order = order
                        batch.save(update_fields=['order'])

                        # Collection confirmation (market agent picks up)
                        collect_dt = dist_receipt_dt + timedelta(hours=random.uniform(4, 24))
                        self_loss_kg  = round(weight_at_dist * rnd(0.5, 2.0) / 100, 2)
                        arrived_kg    = round(weight_at_dist - self_loss_kg, 2)
                        self_loss_pct = round(self_loss_kg / weight_at_dist * 100, 2) if weight_at_dist > 0 else 0

                        CollectionConfirmation.objects.create(
                            order=order,
                            market_agent=agent,
                            quantity_collected_kg=weight_at_dist,
                            collected_at=collect_dt,
                            step1_idempotency_key=uuid.uuid4(),
                            quantity_arrived_at_stall_kg=arrived_kg,
                            arrived_at=collect_dt + timedelta(hours=rnd(0.5, 1.5)),
                            step2_idempotency_key=uuid.uuid4(),
                            self_transport_loss_kg=self_loss_kg,
                            self_transport_loss_pct=self_loss_pct,
                        )

                        # Waste report (end of selling period)
                        period_start = collect_dt.date()
                        period_end   = period_start + timedelta(days=random.randint(3, 7))
                        discarded_kg = round(arrived_kg * rnd(2.0, 8.0) / 100, 2)
                        sold_kg      = round(arrived_kg - discarded_kg, 2)
                        spoilage_pct = round(discarded_kg / (sold_kg + discarded_kg) * 100, 2) if (sold_kg + discarded_kg) > 0 else 0

                        WasteReport.objects.create(
                            market_agent=agent,
                            order=order,
                            reporting_period_start=period_start,
                            reporting_period_end=period_end,
                            quantity_sold_kg=sold_kg,
                            quantity_discarded_kg=discarded_kg,
                            discard_reason=random.choice(['SPOILAGE', 'SPOILAGE', 'NO_DEMAND', 'DAMAGE']),
                            market_spoilage_loss_pct=spoilage_pct,
                            idempotency_key=uuid.uuid4(),
                        )
                    else:
                        # Trip record — pickup confirmed, delivery not yet, so the cooperative's
                        # "Live Location" map has something to actually show for this batch.
                        actual_pickup = dispatch_dt + timedelta(hours=1, minutes=random.randint(0, 30))
                        trip = Trip.objects.create(
                            transport_request=tr,
                            actual_pickup_datetime=actual_pickup,
                            pickup_confirmed_at=actual_pickup,
                        )
                        lerp = lambda a, b, t: a + (b - a) * t
                        for i, progress in enumerate((0.2, 0.35, 0.45)):
                            GPSTrack.objects.create(
                                trip=trip,
                                latitude=round(lerp(cfg['gps'][0], float(dist.warehouse_gps_lat), progress), 6),
                                longitude=round(lerp(cfg['gps'][1], float(dist.warehouse_gps_lng), progress), 6),
                                speed_kmh=round(random.uniform(35, 55), 1),
                                timestamp=actual_pickup + timedelta(minutes=15 * (i + 1)),
                            )

                        # Vehicle temperature readings — only meaningful for cold-chain cargo,
                        # but always seeded so "Live Data" has something real to show. One
                        # district's trip runs slightly hot so the breach-alert UI has a
                        # real case to display too, not just clean readings.
                        is_breach_demo = (district == 'Musanze')
                        base_temp = (float(crop.safe_temp_max_amber) - 3) if crop.safe_temp_max_amber else 5.0
                        for i in range(4):
                            temp = base_temp + (3.5 if is_breach_demo and i == 3 else random.uniform(-0.5, 0.8))
                            VehicleIoTReading.objects.create(
                                trip=trip,
                                temperature_celsius=round(temp, 1),
                                timestamp=actual_pickup + timedelta(minutes=10 * (i + 1)),
                            )

                    batch_count += 1

        # One explicit multi-stop / shared-trip scenario: a cooperative dispatches two
        # different crops to the same distributor on one truck — so the distributor's
        # "Confirm All" bulk-receipt UI and the cooperative's "sharing this trip" badge
        # both have a real, reliable case to demo right after a reset.
        musanze_coop, musanze_mgr = coops['Musanze']
        shared_dist = dist_list[0]
        shared_trans = trans_list[0]
        shared_pickup_dt = timezone.now() - timedelta(hours=3)
        shared_tr = TransportRequest.objects.create(
            requested_by_cooperative=musanze_coop,
            transporter=shared_trans,
            leg_number=1,
            pickup_location=DISTRICT_CFG['Musanze']['pickup_loc'],
            pickup_gps_lat=DISTRICT_CFG['Musanze']['gps'][0],
            pickup_gps_lng=DISTRICT_CFG['Musanze']['gps'][1],
            destination=shared_dist.warehouse_location,
            destination_gps_lat=shared_dist.warehouse_gps_lat,
            destination_gps_lng=shared_dist.warehouse_gps_lng,
            cargo_description='Mixed produce — shared trip',
            estimated_cargo_weight_kg=3200,
            requires_refrigeration=False,
            required_pickup_datetime=shared_pickup_dt,
            status='ACCEPTED',
            accepted_at=shared_pickup_dt,
        )
        shared_trip = Trip.objects.create(transport_request=shared_tr, actual_pickup_datetime=shared_pickup_dt, pickup_confirmed_at=shared_pickup_dt)
        for i, progress in enumerate((0.25, 0.5, 0.7)):
            GPSTrack.objects.create(
                trip=shared_trip,
                latitude=round(DISTRICT_CFG['Musanze']['gps'][0] + (float(shared_dist.warehouse_gps_lat) - DISTRICT_CFG['Musanze']['gps'][0]) * progress, 6),
                longitude=round(DISTRICT_CFG['Musanze']['gps'][1] + (float(shared_dist.warehouse_gps_lng) - DISTRICT_CFG['Musanze']['gps'][1]) * progress, 6),
                speed_kmh=round(random.uniform(35, 55), 1),
                timestamp=shared_pickup_dt + timedelta(minutes=20 * (i + 1)),
            )
        for i in range(4):
            VehicleIoTReading.objects.create(
                trip=shared_trip,
                temperature_celsius=round(random.uniform(8, 11), 1),
                timestamp=shared_pickup_dt + timedelta(minutes=15 * (i + 1)),
            )
        for crop_name, kg in (('Avocados', 1800), ('Bananas', 1400)):
            crop = crops.get(crop_name)
            if not crop:
                continue
            shared_pr = ProduceRequest.objects.create(
                distributor=shared_dist, cooperative=musanze_coop, crop=crop,
                quantity_kg=kg, quality_grade_required='A',
                required_delivery_date=shared_pickup_dt.date(),
                status='ACCEPTED', responded_at=shared_pickup_dt - timedelta(days=1),
            )
            shared_sa = SupplyAgreement.objects.create(
                produce_request=shared_pr, agreed_quantity_kg=kg,
                agreed_quality_grade='A', agreed_delivery_date=shared_pickup_dt.date(),
            )
            Batch.objects.create(
                cooperative=musanze_coop,
                crop=crop,
                supply_agreement=shared_sa,
                dispatched_by=musanze_mgr,
                dispatch_weight_kg=kg,
                quality_grade_at_dispatch='A',
                dispatch_timestamp=shared_pickup_dt,
                transport_request_leg1=shared_tr,
                current_status='IN_TRANSIT_LEG1',
            )
            batch_count += 1

        self.stdout.write(f'    {batch_count} batches created (with trips, orders, confirmations, waste reports)')

    # ── Cold storage facilities + IoT readings ───────────────────────────────

    def _seed_storage_facilities(self, coops):
        from apps.cooperatives.models import ColdStorageFacility
        from apps.iot.models import IoTReading

        self.stdout.write('  Seeding storage facilities and IoT readings...')
        facility_defs = {
            'Musanze': [('Kinigi Cold Store A', 500, 12.0, 18.0)],
            'Rubavu':  [('Gisenyi Storage Unit 1', 300, 14.0, 20.0)],
            'Nyanza':  [('Nyanza Dry Store', 400, 20.0, 28.0)],
            'Kigali':  [('Nyarugenge Hub Store', 600, 15.0, 22.0)],
        }
        count = 0
        for district, facs in facility_defs.items():
            coop, _ = coops[district]
            for name, cap_kg, amber, red in facs:
                facility, _ = ColdStorageFacility.objects.get_or_create(
                    cooperative=coop, name=name,
                    defaults=dict(
                        capacity_kg=cap_kg,
                        has_iot_sensor=True,
                        sensor_device_id=f'ESP32-{district[:3].upper()}-01',
                        temp_threshold_amber_celsius=amber,
                        temp_threshold_red_celsius=red,
                        humidity_threshold_percent=85.0,
                        location_description=f'{district} district storage',
                        is_active=True,
                    ),
                )
                # Add a fresh IoT reading (normal range)
                base_temp = round(random.uniform(amber - 4, amber - 1), 1)
                IoTReading.objects.create(
                    facility=facility,
                    temperature_celsius=base_temp,
                    humidity_percent=round(random.uniform(60, 75), 1),
                    timestamp=timezone.now(),
                )
                count += 1
        self.stdout.write(f'    {count} storage facilities with IoT readings ready')

    # ── Pending produce requests ─────────────────────────────────────────────

    def _seed_pending_requests(self, coops, distributors, crops):
        from apps.distribution.models import ProduceRequest
        from apps.transport.models import Transporter, TransportRequest

        self.stdout.write('  Seeding pending produce requests...')
        dist_kigali = distributors.get('dist.kigali')
        dist_north  = distributors.get('dist.north')
        if not dist_kigali or not dist_north:
            return

        requests_cfg = [
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
        count = 0
        today = date.today()
        for district, dist, crop_name, qty, grade, days in requests_cfg:
            coop, _ = coops[district]
            crop = crops.get(crop_name)
            if not crop:
                continue
            due = today + timedelta(days=days)
            ProduceRequest.objects.get_or_create(
                distributor=dist, cooperative=coop, crop=crop,
                status='PENDING',
                defaults=dict(
                    quantity_kg=qty,
                    quality_grade_required=grade,
                    required_delivery_date=due,
                    additional_notes='',
                ),
            )
            count += 1
        self.stdout.write(f'    {count} pending produce requests created')

        # ── Mobile demo transport requests ────────────────────────────────────
        # Seed 2 PENDING + 1 ACCEPTED (active trip) transport requests assigned
        # directly to driver.mugenzi so the mobile transporter screens have data.
        self.stdout.write('  Seeding mobile demo transport requests for driver.mugenzi...')
        try:
            driver = Transporter.objects.get(user__username='driver.mugenzi')
        except Transporter.DoesNotExist:
            self.stdout.write('    driver.mugenzi not found, skipping mobile demo requests')
            return

        musanze_coop, _ = coops['Musanze']
        kigali_coop, _  = coops['Kigali']
        pickup_dt = timezone.now() + timedelta(hours=2)

        mobile_requests = [
            dict(
                transporter=driver,
                requested_by_cooperative=musanze_coop,
                leg_number=1,
                pickup_location='Musanze Market Hub, Northern Province',
                pickup_gps_lat=DISTRICT_CFG['Musanze']['gps'][0],
                pickup_gps_lng=DISTRICT_CFG['Musanze']['gps'][1],
                destination=dist_kigali.warehouse_location,
                destination_gps_lat=dist_kigali.warehouse_gps_lat,
                destination_gps_lng=dist_kigali.warehouse_gps_lng,
                cargo_description='Tomatoes — Grade A',
                estimated_cargo_weight_kg=320,
                requires_refrigeration=True,
                required_pickup_datetime=pickup_dt,
                status='PENDING',
            ),
            dict(
                transporter=driver,
                requested_by_cooperative=kigali_coop,
                leg_number=1,
                pickup_location='Kigali Farm Hub, Nyarugenge District',
                pickup_gps_lat=DISTRICT_CFG['Kigali']['gps'][0],
                pickup_gps_lng=DISTRICT_CFG['Kigali']['gps'][1],
                destination=dist_north.warehouse_location,
                destination_gps_lat=dist_north.warehouse_gps_lat,
                destination_gps_lng=dist_north.warehouse_gps_lng,
                cargo_description='Avocados — Grade A',
                estimated_cargo_weight_kg=480,
                requires_refrigeration=False,
                required_pickup_datetime=pickup_dt + timedelta(hours=4),
                status='PENDING',
            ),
        ]
        for req_data in mobile_requests:
            TransportRequest.objects.get_or_create(
                transporter=driver,
                status='PENDING',
                cargo_description=req_data['cargo_description'],
                defaults=req_data,
            )

        # One ACCEPTED request so Active Trip screen also has data
        active_pickup_dt = timezone.now() - timedelta(hours=1)
        active_tr, _ = TransportRequest.objects.get_or_create(
            transporter=driver,
            status='ACCEPTED',
            cargo_description='Maize — Grade B (active)',
            defaults=dict(
                requested_by_cooperative=musanze_coop,
                leg_number=1,
                pickup_location='Musanze Market Hub, Northern Province',
                pickup_gps_lat=DISTRICT_CFG['Musanze']['gps'][0],
                pickup_gps_lng=DISTRICT_CFG['Musanze']['gps'][1],
                destination=dist_kigali.warehouse_location,
                destination_gps_lat=dist_kigali.warehouse_gps_lat,
                destination_gps_lng=dist_kigali.warehouse_gps_lng,
                cargo_description='Maize — Grade B (active)',
                estimated_cargo_weight_kg=600,
                requires_refrigeration=False,
                required_pickup_datetime=active_pickup_dt,
                status='ACCEPTED',
                accepted_at=active_pickup_dt,
            ),
        )
        from apps.transport.models import Trip
        Trip.objects.get_or_create(
            transport_request=active_tr,
            defaults=dict(actual_pickup_datetime=active_pickup_dt),
        )
        self.stdout.write('    2 pending + 1 active trip seeded for driver.mugenzi')

        # ── Mobile demo data for agent.kimironko ──────────────────────────────
        # Guarantee notices, orders, a collection confirmation and a waste report
        # are tied to agent.kimironko so the market-agent mobile screens always
        # have something to show regardless of the random batch assignment above.
        self.stdout.write('  Seeding mobile demo data for agent.kimironko...')
        from apps.market_agents.models import MarketAgent, CollectionConfirmation, WasteReport
        from apps.distribution.models import CollectionNotice, Order
        from apps.cooperatives.models import Crop
        try:
            kimironko = MarketAgent.objects.get(user__username='agent.kimironko')
        except MarketAgent.DoesNotExist:
            self.stdout.write('    agent.kimironko not found, skipping')
            return

        tomato = Crop.objects.filter(name='Tomatoes').first()
        avocado = Crop.objects.filter(name='Avocados').first()
        now = timezone.now()

        for crop, qty, label in [
            (tomato,  280, 'Tomatoes — Grade A'),
            (avocado, 350, 'Avocados — Grade A'),
        ]:
            if not crop:
                continue
            notice = CollectionNotice.objects.create(
                distributor=dist_kigali,
                crop=crop,
                pickup_location=dist_kigali.warehouse_location,
                available_quantity_kg=qty,
                collection_deadline=now + timedelta(days=5),
            )
            order = Order.objects.create(
                collection_notice=notice,
                market_agent=kimironko,
                distributor=dist_kigali,
                quantity_requested_kg=qty,
                confirmed_quantity_kg=qty,
                delivery_method='SELF_COLLECTION',
                status='COMPLETED',
                confirmed_at=now - timedelta(hours=6),
            )
            collect_dt = now - timedelta(hours=4)
            self_loss = round(qty * 0.012, 2)
            arrived = round(qty - self_loss, 2)
            CollectionConfirmation.objects.create(
                order=order,
                market_agent=kimironko,
                quantity_collected_kg=qty,
                collected_at=collect_dt,
                step1_idempotency_key=uuid.uuid4(),
                quantity_arrived_at_stall_kg=arrived,
                arrived_at=collect_dt + timedelta(minutes=45),
                step2_idempotency_key=uuid.uuid4(),
                self_transport_loss_kg=self_loss,
                self_transport_loss_pct=round(self_loss / qty * 100, 2),
            )
            discarded = round(arrived * 0.04, 2)
            sold = round(arrived - discarded, 2)
            WasteReport.objects.create(
                order=order,
                market_agent=kimironko,
                reporting_period_start=(now - timedelta(days=3)).date(),
                reporting_period_end=now.date(),
                quantity_sold_kg=sold,
                quantity_discarded_kg=discarded,
                discard_reason='SPOILAGE',
                market_spoilage_loss_pct=round(discarded / arrived * 100, 2),
                idempotency_key=uuid.uuid4(),
            )
        self.stdout.write('    notices, orders, collections and waste reports seeded for agent.kimironko')

    # ── Warehouse manager (independent cold-storage operator) ───────────────

    def _seed_warehouse_manager(self, coops):
        from apps.authentication.models import User
        from apps.cooperatives.models import WarehouseManager, ColdStorageFacility, WarehouseRentalRequest
        from apps.iot.models import IoTReading

        self.stdout.write('  Seeding warehouse manager...')

        user, _ = User.objects.get_or_create(
            username='wh.mugisha',
            defaults=dict(
                first_name='Bosco', last_name='Mugisha',
                email='b.mugisha@chainsight.demo', phone_number='+250788500001',
                role='WAREHOUSE_MANAGER', organization_name='Mugisha Cold Chain Ltd',
                is_verified=True, must_change_password=False,
            ),
        )
        user.set_password(DEMO_PASSWORD)
        user.save()

        wh, _ = WarehouseManager.objects.get_or_create(
            user=user,
            defaults=dict(company_name='Mugisha Cold Chain Ltd', district='Kigali',
                           contact_phone='+250788500001'),
        )

        facility, created = ColdStorageFacility.objects.get_or_create(
            warehouse_manager=wh, name='Gikondo Cold Hub',
            defaults=dict(
                capacity_kg=1200, location_description='Gikondo Industrial Zone, Kigali',
                gps_latitude=-1.9706, gps_longitude=30.0764,
                has_iot_sensor=True, sensor_device_id='ESP32-GKD-01',
                is_available_for_rent=True, rental_price_per_month=180000,
                temp_threshold_amber_celsius=15.0, temp_threshold_red_celsius=20.0,
                humidity_threshold_percent=85.0, is_active=True,
            ),
        )
        if created:
            IoTReading.objects.create(
                facility=facility, temperature_celsius=13.5,
                humidity_percent=68.0, timestamp=timezone.now(),
            )

        nyanza_coop, _ = coops['Nyanza']
        WarehouseRentalRequest.objects.get_or_create(
            cooperative=nyanza_coop, facility=facility,
            defaults=dict(
                requested_capacity_kg=250,
                notes='Need overflow storage capacity during harvest peak.',
                status='PENDING',
            ),
        )

        self.stdout.write('    1 warehouse manager with 1 listed facility and 1 pending rental request ready')

    # ── AI Insights — Daily Intelligence Brief (MINAGRI dashboard) ───────────
    # Mirrors apps.ai_insights.tasks.generate_daily_insights(), but computed over the most
    # recent seeded month instead of literally "yesterday" (which has no data in a historical
    # demo dataset) so the MINAGRI dashboard has a real, data-driven brief to show.

    def _seed_ai_insights(self):
        from django.db.models import Sum, Count
        from apps.traceability.models import Batch
        from apps.ai_insights.models import AIInsight, DailyBriefBundle

        self.stdout.write('  Seeding AI Insights daily brief...')

        year, month = MONTHS[-1]
        period_start = date(year, month, 1)
        period_end = date(year, month, 28)  # all seeded batches dispatch on day <= 28

        batches = Batch.objects.filter(
            dispatch_timestamp__year=year, dispatch_timestamp__month=month,
            current_status='COMPLETED',
        )
        agg = batches.aggregate(
            total_batches=Count('id'),
            total_volume=Sum('dispatch_weight_kg'),
            total_transit_loss=Sum('transit_loss_leg1_kg'),
            total_self_transport=Sum('self_transport_loss_kg'),
            total_market=Sum('market_spoilage_loss_kg'),
            total_loss=Sum('total_loss_kg'),
        )
        total_vol = float(agg['total_volume'] or 0)
        total_loss = float(agg['total_loss'] or 0)
        loss_pct = round((total_loss / total_vol * 100), 2) if total_vol > 0 else 0

        insights = []

        insights.append(AIInsight.objects.create(
            insight_type=AIInsight.InsightType.NATIONAL_LOSS,
            title='National Post-Harvest Loss Summary',
            content=(
                f"Total post-harvest loss in {period_start.strftime('%B %Y')} was {total_loss:,.1f} kg "
                f"across {agg['total_batches']} completed batches, representing {loss_pct}% of dispatched volume."
            ),
            data_period_start=period_start, data_period_end=period_end,
        ))

        district_rows = list(
            batches.values('cooperative__district').annotate(
                vol=Sum('dispatch_weight_kg'), loss=Sum('total_loss_kg'), count=Count('id'),
            )
        )
        worst = None
        for row in district_rows:
            vol = float(row['vol'] or 0)
            row['rate'] = round((float(row['loss'] or 0) / vol * 100), 2) if vol > 0 else 0
            if not worst or row['rate'] > worst['rate']:
                worst = row
        if worst and worst['rate'] > 8:
            district_name = worst['cooperative__district'] or 'Unknown'
            insights.append(AIInsight.objects.create(
                insight_type=AIInsight.InsightType.ROUTE_ALERT,
                title=f'High Loss Alert: {district_name} District',
                content=(
                    f"{district_name} district recorded a {worst['rate']}% loss rate in {period_start.strftime('%B %Y')} "
                    f"across {worst['count']} batches — above the cooperative-level alert threshold. "
                    f"Recommend reviewing transit conditions and cold-chain handling on this route."
                ),
                data_period_start=period_start, data_period_end=period_end,
                is_critical=worst['rate'] > 12,
                related_district=district_name,
            ))

        stages = {
            'Transit (Leg 1)': float(agg['total_transit_loss'] or 0),
            'Self-transport':  float(agg['total_self_transport'] or 0),
            'Market spoilage': float(agg['total_market'] or 0),
        }
        top_stage = max(stages, key=stages.get)
        insights.append(AIInsight.objects.create(
            insight_type=AIInsight.InsightType.STAGE_BREAKDOWN,
            title='Loss Stage Breakdown',
            content=(
                f"The highest loss stage in {period_start.strftime('%B %Y')} was {top_stage} "
                f"at {stages[top_stage]:,.1f} kg. " + ' | '.join(f'{k}: {v:,.1f}kg' for k, v in stages.items())
            ),
            data_period_start=period_start, data_period_end=period_end,
        ))

        bundle = DailyBriefBundle.objects.create(
            brief_date=date.today(),
            summary_text=(
                f"{agg['total_batches']} batches tracked in {period_start.strftime('%B %Y')} · "
                f"{loss_pct}% national loss rate · {len(insights)} insights generated."
            ),
        )
        bundle.insights.set(insights)

        self.stdout.write(f'    1 daily brief with {len(insights)} insights ready')

    # ── Pending access requests (so Admin → Registration Queue has something) ─

    def _seed_access_requests(self):
        from apps.authentication.models import AccessRequest, User

        self.stdout.write('  Seeding pending access requests...')
        requests = [
            dict(full_name='Eric Mugabo', role_requested='COOPERATIVE_MANAGER',
                 organization_name='Gakenke Farmers Cooperative', district='Gakenke',
                 phone_number='+250788900001', email='e.mugabo@applicant.demo', acknowledgement=True),
            dict(full_name='Claudine Uwizeye', role_requested='DISTRIBUTOR',
                 organization_name='Huye Fresh Produce Ltd', district='Huye',
                 phone_number='+250788900002', email='c.uwizeye@applicant.demo', acknowledgement=True),
            dict(full_name='Patrick Niyonsenga', role_requested='MARKET_AGENT',
                 organization_name='Remera Vegetables Market', district='Kigali',
                 phone_number='+250788900003', email='p.niyonsenga@applicant.demo', acknowledgement=True),
        ]
        count = 0
        for r in requests:
            if not User.objects.filter(phone_number=r['phone_number']).exists():
                AccessRequest.objects.get_or_create(email=r['email'], defaults=r)
                count += 1
        self.stdout.write(f'    {count} pending access requests ready')

    # ── Credentials printout ─────────────────────────────────────────────────

    def _print_credentials(self):
        # Login only matches on email or phone_number (see LoginSerializer) — the
        # `username` field is for DB/admin reference only and will NOT log in.
        lines = [
            '',
            '=' * 70,
            ' DEMO LOGIN CREDENTIALS  (password: Demo1234!)',
            ' Log in with the EMAIL below - usernames do not work as login credentials.',
            '=' * 70,
            f'  {"Role":<25} {"Login email":<32}',
            '-' * 70,
            f'  {"Admin":<25} {"admin@chainsight.demo":<32}',
            f'  {"MINAGRI Officer":<25} {"c.nzeyimana@minagri.demo":<32}',
            f'  {"Cooperative (Musanze)":<25} {"j.habimana@chainsight.demo":<32}',
            f'  {"Cooperative (Rubavu)":<25} {"i.mukamana@chainsight.demo":<32}',
            f'  {"Cooperative (Nyanza)":<25} {"mc.uwimana@chainsight.demo":<32}',
            f'  {"Cooperative (Kigali)":<25} {"p.habimana@chainsight.demo":<32}',
            f'  {"Transport Company 1":<25} {"a.kalinda@chainsight.demo":<32}',
            f'  {"  - Driver (Mugenzi)":<25} {"p.mugenzi@chainsight.demo":<32}',
            f'  {"  - Driver (Uwase)":<25} {"d.uwase@chainsight.demo":<32}',
            f'  {"Transport Company 2":<25} {"e.gasana@chainsight.demo":<32}',
            f'  {"  - Driver (Mutesi)":<25} {"c.mutesi@chainsight.demo":<32}',
            f'  {"Distributor 1":<25} {"s.nkurunziza@chainsight.demo":<32}',
            f'  {"Distributor 2":<25} {"e.ingabire@chainsight.demo":<32}',
            f'  {"Market Agent (Kimironko)":<25} {"g.uwera@chainsight.demo":<32}',
            f'  {"Market Agent (Nyabugogo)":<25} {"e.nshimiyimana@chainsight.demo":<32}',
            f'  {"Market Agent (Remera)":<25} {"d.mukankusi@chainsight.demo":<32}',
            f'  {"Warehouse Manager":<25} {"b.mugisha@chainsight.demo":<32}',
            '=' * 70,
            '',
        ]
        for line in lines:
            self.stdout.write(self.style.SUCCESS(line))
