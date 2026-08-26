import csv
import io
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Report
from .serializers import ReportSerializer
from apps.authentication.permissions import IsAnalyticsRole


class ReportViewSet(viewsets.ModelViewSet):
    serializer_class = ReportSerializer
    permission_classes = [IsAnalyticsRole]

    def get_queryset(self):
        qs = Report.objects.all()
        report_type = self.request.query_params.get('type')
        rpt_status = self.request.query_params.get('status')
        if report_type:
            qs = qs.filter(report_type=report_type)
        if rpt_status:
            qs = qs.filter(status=rpt_status)
        return qs

    def perform_create(self, serializer):
        serializer.save(
            generated_by_user=self.request.user,
            status=Report.Status.QUEUED,
        )

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        report = self.get_object()
        if report.status != Report.Status.READY or not report.file_path:
            return Response({'detail': 'Report is not ready for download.'},
                            status=status.HTTP_400_BAD_REQUEST)
        return FileResponse(report.file_path.open('rb'),
                            as_attachment=True,
                            filename=f"{report.title}.{report.format.lower()}")


# ─── Live CSV/PDF Export (role-aware, multi-type) ──────────────────────────

class ExportReportView(APIView):
    """
    GET /api/v1/reports/export/?report_type=<type>&file_format=csv|pdf
    (NOT "format" — DRF reserves that query param for its own content negotiation.)
    Streams a report for the authenticated user, as CSV (default) or PDF.
    report_type defaults to the primary report for each role.
    Available types per role:
      COOPERATIVE_MANAGER : batches | stock | transport | waste
      TRANSPORTER         : jobs | performance
      TRANSPORT_COMPANY   : jobs | performance
      DISTRIBUTOR         : orders | delivery-comparison | waste
      MARKET_AGENT        : collections | waste | loss-summary
      MINAGRI_OFFICER     : national | districts | crops | transport | waste
      ADMIN               : national | districts | crops | transport | users | waste
      WAREHOUSE_MANAGER   : facilities | rentals

    Each `_xxx` handler below returns (title, headers, rows, base_filename) — the
    CSV/PDF renderers are shared so both formats always stay in sync.
    """
    permission_classes = [permissions.IsAuthenticated]

    # ── dispatch table ──────────────────────────────────────────────────────
    _HANDLERS = {
        'COOPERATIVE_MANAGER': {
            'batches':   '_coop_batches',
            'stock':     '_coop_stock',
            'transport': '_coop_transport',
            'waste':     '_coop_waste',
            'complete':  '_coop_complete',
        },
        'TRANSPORTER': {
            'jobs':        '_trans_jobs',
            'performance': '_trans_performance',
            'complete':    '_trans_complete',
        },
        'TRANSPORT_COMPANY': {
            'jobs':        '_trans_jobs',
            'performance': '_trans_performance',
            'complete':    '_trans_complete',
        },
        'DISTRIBUTOR': {
            'orders':              '_dist_orders',
            'requests':            '_dist_requests',
            'receipts':            '_dist_receipts',
            'mismatches':          '_dist_mismatches',
            'delivery-comparison': '_dist_delivery_comparison',
            'waste':               '_dist_waste',
            'complete':            '_dist_complete',
        },
        'MARKET_AGENT': {
            'collections':  '_agent_collections',
            'waste':        '_agent_waste',
            'complete':     '_agent_complete',
            'loss-summary': '_agent_loss_summary',
        },
        'MINAGRI_OFFICER': {
            'national':  '_national',
            'districts': '_national_districts',
            'crops':     '_national_crops',
            'transport': '_national_transport',
            'waste':     '_national_waste',
            'complete':  '_national_complete',
        },
        'ADMIN': {
            'national':  '_national',
            'districts': '_national_districts',
            'crops':     '_national_crops',
            'transport': '_national_transport',
            'users':     '_admin_users',
            'waste':     '_national_waste',
            'complete':  '_admin_complete',
        },
        'WAREHOUSE_MANAGER': {
            'facilities': '_warehouse_facilities',
            'rentals':    '_warehouse_rentals',
            'complete':   '_warehouse_complete',
        },
    }

    _DEFAULTS = {
        'COOPERATIVE_MANAGER': 'batches',
        'TRANSPORTER':         'jobs',
        'TRANSPORT_COMPANY':   'jobs',
        'DISTRIBUTOR':         'orders',
        'MARKET_AGENT':        'collections',
        'MINAGRI_OFFICER':     'national',
        'ADMIN':               'national',
        'WAREHOUSE_MANAGER':   'facilities',
    }

    # ── shared renderers ────────────────────────────────────────────────────

    @staticmethod
    def _csv_response(headers, rows, base_filename, extra_sections=None):
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(headers)
        writer.writerows(rows)
        for section_title, section_headers, section_rows in (extra_sections or []):
            writer.writerow([])
            writer.writerow([section_title])
            writer.writerow(section_headers)
            writer.writerows(section_rows)
        buf.seek(0)
        resp = HttpResponse(buf.getvalue(), content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = f'attachment; filename="{base_filename}.csv"'
        return resp

    @staticmethod
    def _pdf_response(title, headers, rows, base_filename, request, extra_sections=None, chart_spec=None):
        generated_by = request.user.get_full_name() or request.user.phone_number
        role_label   = request.user.role.replace('_', ' ').title()
        pdf_bytes = ExportReportView._build_pdf_bytes(
            title, headers, rows, generated_by, role_label,
            extra_sections=extra_sections, chart_spec=chart_spec,
        )
        resp = HttpResponse(pdf_bytes, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{base_filename}.pdf"'
        return resp

    @staticmethod
    def _build_pdf_bytes(title, headers, rows, generated_by, role_label, extra_sections=None, chart_spec=None):
        """
        Core PDF byte-builder shared by the live _pdf_response (HTTP download, generated_by
        taken from request.user) and apps.reports.tasks (scheduled Celery jobs, generated_by
        passed as 'Scheduled Job' — no request exists in that context).
        """
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import cm
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT, TA_JUSTIFY
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph,
            Spacer, HRFlowable, KeepTogether,
        )
        from reportlab.graphics.shapes import Drawing, String
        from reportlab.graphics.charts.barcharts import VerticalBarChart
        from reportlab.graphics.charts.legends import Legend

        GREEN_DARK  = colors.HexColor('#0b2b18')
        GREEN_MID   = colors.HexColor('#1a5c34')
        GREEN_LIGHT = colors.HexColor('#eef7f2')
        GREEN_ACC   = colors.HexColor('#228b52')
        GRAY_LINE   = colors.HexColor('#e5e7eb')
        GRAY_ALT    = colors.HexColor('#f9fafb')
        TEXT_DARK   = colors.HexColor('#111827')
        TEXT_MID    = colors.HexColor('#6b7280')

        buf = io.BytesIO()
        page_w, page_h = landscape(A4)
        margin = 1.8 * cm
        content_w = page_w - 2 * margin

        doc = SimpleDocTemplate(
            buf, pagesize=landscape(A4),
            topMargin=margin, bottomMargin=1.4 * cm,
            leftMargin=margin, rightMargin=margin,
        )

        styles = getSampleStyleSheet()
        styles.add(ParagraphStyle('ReportTitle',  fontSize=18, leading=22, fontName='Helvetica-Bold',
                                  textColor=colors.white, spaceAfter=2))
        styles.add(ParagraphStyle('ReportMeta',   fontSize=9,  leading=13, fontName='Helvetica',
                                  textColor=colors.HexColor('#86efac'), spaceAfter=0))
        styles.add(ParagraphStyle('SectionHead',  fontSize=11, leading=14, fontName='Helvetica-Bold',
                                  textColor=GREEN_MID, spaceBefore=16, spaceAfter=6))
        styles.add(ParagraphStyle('BodySmall',    fontSize=9,  leading=13, fontName='Helvetica',
                                  textColor=TEXT_MID, spaceAfter=4, alignment=TA_JUSTIFY))
        styles.add(ParagraphStyle('StatLabel',    fontSize=8,  leading=10, fontName='Helvetica',
                                  textColor=TEXT_MID))
        styles.add(ParagraphStyle('StatValue',    fontSize=14, leading=17, fontName='Helvetica-Bold',
                                  textColor=GREEN_MID))
        styles.add(ParagraphStyle('CellPara',     fontSize=8.5, leading=11, fontName='Helvetica',
                                  textColor=TEXT_DARK, wordWrap='CJK'))
        styles.add(ParagraphStyle('CellParaGray', fontSize=8.5, leading=11, fontName='Helvetica',
                                  textColor=TEXT_MID))
        styles.add(ParagraphStyle('FooterText',   fontSize=8,  leading=11, fontName='Helvetica-Oblique',
                                  textColor=TEXT_MID, alignment=TA_CENTER))

        generated_at = timezone.now().strftime('%d %B %Y at %H:%M')

        # ── Helper: build a styled, wrapping data table ───────────────────────
        def _make_table(hdrs, data_rows, extra_width=0):
            if not data_rows:
                return Paragraph('No records in this period.', styles['BodySmall'])
            n = len(hdrs)
            unit = (content_w + extra_width) / n
            col_w = [unit] * n

            def wrap(val, gray=False):
                s = str(val) if val is not None and str(val) != 'None' else '—'
                style = styles['CellParaGray'] if gray else styles['CellPara']
                return Paragraph(s, style)

            hdr_style = ParagraphStyle('HdrCell', fontSize=8.5, leading=11,
                                       fontName='Helvetica-Bold', textColor=colors.white)
            t_data = [[Paragraph(h, hdr_style) for h in hdrs]]
            for i, row in enumerate(data_rows):
                is_alt = i % 2 == 1
                t_data.append([wrap(c, gray=is_alt) for c in row])

            tbl = Table(t_data, colWidths=col_w, repeatRows=1)
            tbl.setStyle(TableStyle([
                ('BACKGROUND',    (0, 0), (-1,  0), GREEN_MID),
                ('ROWBACKGROUNDS',(0, 1), (-1, -1), [colors.white, GRAY_ALT]),
                ('GRID',          (0, 0), (-1, -1), 0.4, GRAY_LINE),
                ('LINEBELOW',     (0, 0), (-1,  0), 1.2, GREEN_ACC),
                ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING',    (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('LEFTPADDING',   (0, 0), (-1, -1), 6),
                ('RIGHTPADDING',  (0, 0), (-1, -1), 6),
            ]))
            return tbl

        # ── Helper: compute quick summary stats from numeric columns ──────────
        def _summary_stats(hdrs, data_rows):
            if not data_rows or not hdrs:
                return []
            stats = []
            for col_idx, col_name in enumerate(hdrs):
                vals = []
                for row in data_rows:
                    try:
                        v = float(row[col_idx])
                        vals.append(v)
                    except (ValueError, TypeError, IndexError):
                        pass
                if vals and any(kw in col_name.lower() for kw in ('kg', 'loss', 'rate', 'weight', '%', 'count', 'total')):
                    total = sum(vals)
                    avg   = total / len(vals)
                    disp  = f'{total:,.1f}' if total != int(total) else f'{int(total):,}'
                    if '%' in col_name or 'rate' in col_name.lower():
                        disp = f'{avg:.1f}%'
                    stats.append((col_name, disp))
                    if len(stats) >= 4:
                        break
            return stats

        # ── Page-header banner (green block) ─────────────────────────────────
        banner_data = [[
            Paragraph(title, styles['ReportTitle']),
            Paragraph(
                f'Generated {generated_at}<br/>'
                f'By {generated_by} ({role_label})<br/>'
                f'ChainSight Supply Chain Analytics — Rwanda',
                styles['ReportMeta'],
            ),
        ]]
        banner = Table(banner_data, colWidths=[content_w * 0.62, content_w * 0.38])
        banner.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), GREEN_DARK),
            ('TOPPADDING',    (0, 0), (-1, -1), 14),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 14),
            ('LEFTPADDING',   (0, 0), (-1, -1), 16),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 16),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('ROUNDEDCORNERS', [6]),
        ]))

        elements = [banner, Spacer(1, 0.6 * cm)]

        # ── Summary stats ─────────────────────────────────────────────────────
        stats = _summary_stats(headers, rows)
        if stats:
            stat_cells = []
            for label, value in stats:
                cell = [Paragraph(value, styles['StatValue']), Paragraph(label, styles['StatLabel'])]
                stat_cells.append(cell)
            stat_tbl = Table(
                [stat_cells],
                colWidths=[content_w / len(stats)] * len(stats),
            )
            stat_tbl.setStyle(TableStyle([
                ('BACKGROUND',    (0, 0), (-1, -1), GREEN_LIGHT),
                ('TOPPADDING',    (0, 0), (-1, -1), 10),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
                ('LEFTPADDING',   (0, 0), (-1, -1), 14),
                ('RIGHTPADDING',  (0, 0), (-1, -1), 14),
                ('LINEAFTER',     (0, 0), (-2, -1), 0.6, GRAY_LINE),
                ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ]))
            elements += [stat_tbl, Spacer(1, 0.5 * cm)]

        # ── Chart (analytical reports — a small aggregate, not a row-per-record dump) ──
        if chart_spec and chart_spec.get('categories') and chart_spec.get('series'):
            cats = chart_spec['categories']
            series = chart_spec['series']
            chart_colors = [GREEN_ACC, colors.HexColor('#2E75B6'), colors.HexColor('#C55A11')]

            chart_h = 8.5 * cm
            legend_w = 3.2 * cm if len(series) > 1 else 0
            drawing = Drawing(content_w, chart_h + 1.5 * cm)

            bc = VerticalBarChart()
            bc.x = 1.6 * cm
            bc.y = 0.6 * cm
            bc.width = content_w - 1.6 * cm - legend_w - 0.4 * cm
            bc.height = chart_h - 0.6 * cm
            bc.data = [s['values'] for s in series]
            bc.categoryAxis.categoryNames = cats
            bc.categoryAxis.labels.fontName = 'Helvetica'
            bc.categoryAxis.labels.fontSize = 8
            bc.categoryAxis.labels.angle = 0
            bc.valueAxis.labels.fontName = 'Helvetica'
            bc.valueAxis.labels.fontSize = 8
            bc.valueAxis.valueMin = 0
            bc.barSpacing = 4
            bc.groupSpacing = 14
            bc.barWidth = 12
            for i, _ in enumerate(series):
                bc.bars[i].fillColor = chart_colors[i % len(chart_colors)]
                bc.bars[i].strokeColor = None

            drawing.add(bc)
            drawing.add(String(
                bc.x, chart_h + 0.9 * cm, chart_spec.get('title', ''),
                fontName='Helvetica-Bold', fontSize=10.5, fillColor=TEXT_DARK,
            ))

            if len(series) > 1:
                legend = Legend()
                legend.x = content_w - legend_w + 0.2 * cm
                legend.y = chart_h * 0.6
                legend.alignment = 'left'
                legend.fontName = 'Helvetica'
                legend.fontSize = 8
                legend.dxTextSpace = 6
                legend.deltay = 12
                legend.colorNamePairs = [
                    (chart_colors[i % len(chart_colors)], s['name']) for i, s in enumerate(series)
                ]
                drawing.add(legend)

            elements += [drawing, Spacer(1, 0.4 * cm)]

        # ── Record count note ─────────────────────────────────────────────────
        elements.append(Paragraph(
            f'{len(rows)} record{"s" if len(rows) != 1 else ""} found.',
            styles['BodySmall'],
        ))
        elements.append(Spacer(1, 0.3 * cm))

        # ── Main data table ───────────────────────────────────────────────────
        if not rows:
            elements.append(Paragraph('No data available for this report.', styles['BodySmall']))
        else:
            elements.append(_make_table(headers, rows))

        # ── Extra sections (e.g. route performance in complete reports) ───────
        for section_title, section_headers, section_rows in (extra_sections or []):
            elements += [
                Spacer(1, 0.8 * cm),
                HRFlowable(width=content_w, thickness=1, color=GRAY_LINE),
                Spacer(1, 0.3 * cm),
                Paragraph(section_title, styles['SectionHead']),
                Spacer(1, 0.2 * cm),
                _make_table(section_headers, section_rows),
            ]

        # ── Footer note ───────────────────────────────────────────────────────
        elements += [
            Spacer(1, 0.6 * cm),
            HRFlowable(width=content_w, thickness=0.5, color=GRAY_LINE),
            Spacer(1, 0.2 * cm),
            Paragraph(
                'This report was generated automatically by ChainSight — Rwanda Agricultural Supply Chain Traceability System. '
                'Data reflects the state of the system at the time of generation.',
                styles['FooterText'],
            ),
        ]

        doc.build(elements)
        buf.seek(0)
        return buf.getvalue()

    @staticmethod
    def _parse_date_range(request):
        """
        Extract optional date_from / date_to query params and return as
        aware datetime objects (start of day / end of day) or None.
        """
        from datetime import datetime, time
        import pytz
        tz = pytz.timezone('Africa/Kigali')

        def parse(s):
            try:
                return tz.localize(datetime.strptime(s, '%Y-%m-%d'))
            except Exception:
                return None

        date_from = parse(request.query_params.get('date_from', ''))
        raw_to    = parse(request.query_params.get('date_to', ''))
        # Include the whole 'to' day
        date_to = tz.localize(datetime.combine(raw_to.date(), time.max)) if raw_to else None
        return date_from, date_to

    def get(self, request):
        role = request.user.role
        role_map = self._HANDLERS.get(role)
        if not role_map:
            return Response({'detail': 'No report available for this role.'}, status=403)

        report_type = request.query_params.get('report_type', self._DEFAULTS.get(role, ''))
        method_name = role_map.get(report_type)
        if not method_name:
            method_name = role_map.get(self._DEFAULTS.get(role, ''))
        if not method_name:
            return Response({'detail': f'Unknown report_type "{report_type}" for role {role}.'}, status=400)

        result = getattr(self, method_name)(request)
        if isinstance(result, Response):
            return result  # error path (e.g. missing profile)

        # Handlers normally return a 4-tuple. A 5th element (extra_sections) lets a "combine
        # everything" report append summary tables — e.g. route performance — after the main
        # one. A 6th element (chart_spec) renders a real bar chart in the PDF for reports that
        # are naturally a small aggregate/summary rather than a row-per-record dump — a table
        # is meaningless for two or three summary rows, a chart reads instantly. CSV has no
        # concept of a chart, so chart_spec is PDF-only and ignored for CSV.
        extra_sections = None
        chart_spec = None
        if len(result) == 6:
            title, headers, rows, base_filename, extra_sections, chart_spec = result
        elif len(result) == 5:
            title, headers, rows, base_filename, extra_sections = result
        else:
            title, headers, rows, base_filename = result
        if request.query_params.get('file_format', 'csv').lower() == 'pdf':
            return self._pdf_response(title, headers, rows, base_filename, request,
                                       extra_sections=extra_sections, chart_spec=chart_spec)
        return self._csv_response(headers, rows, base_filename, extra_sections=extra_sections)

    # ── Cooperative Manager ─────────────────────────────────────────────────

    def _coop_batches(self, request):
        from apps.traceability.models import Batch
        try:
            coop = request.user.cooperative
        except Exception:
            return Response({'detail': 'No cooperative profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = Batch.objects.filter(cooperative=coop).select_related('crop')
        if date_from:
            qs = qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            qs = qs.filter(dispatch_timestamp__lte=date_to)

        headers = [
            'Batch ID', 'Crop', 'Dispatch Weight (kg)', 'Status', 'Dispatch Date',
            'Transit Loss (kg)', 'Transit Loss (%)', 'Total Loss (kg)', 'Total Loss (%)',
        ]
        rows = [
            [
                str(b.batch_id)[:8], b.crop.name,
                float(b.dispatch_weight_kg),
                b.get_current_status_display(),
                b.dispatch_timestamp.strftime('%Y-%m-%d') if b.dispatch_timestamp else '',
                float(b.transit_loss_leg1_kg or 0), float(b.transit_loss_leg1_pct or 0),
                float(b.total_loss_kg or 0), float(b.total_loss_pct or 0),
            ]
            for b in qs
        ]
        return f'Cooperative Batch Report — {coop.name}', headers, rows, 'cooperative_batch_report'

    def _coop_stock(self, request):
        from apps.cooperatives.models import CooperativeStock
        try:
            coop = request.user.cooperative
        except Exception:
            return Response({'detail': 'No cooperative profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = CooperativeStock.objects.filter(cooperative=coop).select_related('crop')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        headers = ['Crop', 'Quantity (kg)', 'Quality Grade', 'Harvest Date', 'Available From', 'Available']
        rows = [
            [
                s.crop.name, float(s.quantity_kg), s.quality_grade,
                s.harvest_date.strftime('%Y-%m-%d') if s.harvest_date else '',
                s.available_from.strftime('%Y-%m-%d') if s.available_from else '',
                'Yes' if s.is_available else 'No',
            ]
            for s in qs
        ]
        return f'Cooperative Stock Report — {coop.name}', headers, rows, 'cooperative_stock_report'

    def _coop_transport(self, request):
        from apps.transport.models import TransportRequest
        try:
            coop = request.user.cooperative
        except Exception:
            return Response({'detail': 'No cooperative profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = TransportRequest.objects.filter(requested_by_cooperative=coop).select_related('transporter')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        headers = [
            'Job ID', 'Route', 'Cargo', 'Weight (kg)',
            'Required Pickup', 'Status', 'Transporter',
        ]
        rows = [
            [
                j.id, f"{j.pickup_location} → {j.destination}",
                j.cargo_description, float(j.estimated_cargo_weight_kg or 0),
                j.required_pickup_datetime.strftime('%Y-%m-%d %H:%M') if j.required_pickup_datetime else '',
                j.status,
                j.transporter.company_name if j.transporter else '',
            ]
            for j in qs
        ]
        return f'Cooperative Transport Report — {coop.name}', headers, rows, 'cooperative_transport_report'

    @staticmethod
    def _batch_complete_rows(batches_qs, include_origin=False):
        """
        One row per Batch, threading the full pipeline — dispatch, transport, distributor
        receipt, and market handover — into a single table. Shared by the cooperative's own
        "Complete Activity Report" (scoped) and MINAGRI/Admin's national version (unscoped,
        `include_origin=True` to add the Cooperative/District columns).
        """
        batches = batches_qs.select_related(
            'crop', 'cooperative', 'transport_request_leg1__transporter',
            'received_by_distributor', 'order__market_agent__user',
        ).prefetch_related('order__collection_confirmations')

        headers = (['Cooperative', 'District'] if include_origin else []) + [
            'Batch ID', 'Crop', 'Dispatch Weight (kg)', 'Dispatch Date', 'Status',
            'Transporter (Leg 1)', 'Distributor', 'Weight at Distributor (kg)',
            'Market Agent', 'Collected (kg)', 'Arrived at Stall (kg)',
            'Transit Loss (%)', 'Total Loss (kg)', 'Total Loss (%)',
        ]
        rows = []
        for b in batches:
            confirmation = next(iter(b.order.collection_confirmations.all()), None) if b.order_id else None
            row = (
                [b.cooperative.name, b.cooperative.district] if include_origin else []
            ) + [
                str(b.batch_id)[:8], b.crop.name,
                float(b.dispatch_weight_kg),
                b.dispatch_timestamp.strftime('%Y-%m-%d') if b.dispatch_timestamp else '',
                b.get_current_status_display(),
                b.transport_request_leg1.transporter.company_name if b.transport_request_leg1 and b.transport_request_leg1.transporter else '',
                b.received_by_distributor.company_name if b.received_by_distributor else '',
                float(b.weight_at_distributor_kg) if b.weight_at_distributor_kg is not None else '',
                b.order.market_agent.user.get_full_name() if b.order and b.order.market_agent else '',
                float(confirmation.quantity_collected_kg) if confirmation else '',
                float(confirmation.quantity_arrived_at_stall_kg) if confirmation else '',
                float(b.transit_loss_leg1_pct or 0),
                float(b.total_loss_kg or 0), float(b.total_loss_pct or 0),
            ]
            rows.append(row)
        return headers, rows

    def _coop_complete(self, request):
        from apps.traceability.models import Batch
        try:
            coop = request.user.cooperative
        except Exception:
            return Response({'detail': 'No cooperative profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = Batch.objects.filter(cooperative=coop)
        if date_from:
            qs = qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            qs = qs.filter(dispatch_timestamp__lte=date_to)

        headers, rows = self._batch_complete_rows(qs)
        waste_headers, waste_rows = self._coop_waste_rows(coop, date_from, date_to)
        req_headers, req_rows = self._coop_produce_requests_received_rows(coop, date_from, date_to)
        extra_sections = [
            ('Produce Requests Received from Distributors', req_headers, req_rows),
            ('Pre-Dispatch Waste', waste_headers, waste_rows),
        ]
        return f'Complete Activity Report — {coop.name}', headers, rows, 'cooperative_complete_report', extra_sections

    # ── Transporter ─────────────────────────────────────────────────────────

    def _trans_jobs(self, request):
        from apps.transport.models import TransportRequest
        try:
            transporter = request.user.transporter_profile
        except Exception:
            return Response({'detail': 'No transporter profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = TransportRequest.objects.filter(transporter=transporter)
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        headers = [
            'Job ID', 'Route', 'Cargo', 'Weight (kg)', 'Status',
            'Required Pickup', 'Actual Pickup', 'Delivered', 'Transit Hrs',
        ]
        rows = []
        for j in qs:
            pickup = delivery = hrs = ''
            try:
                t = j.trip
                if t.actual_pickup_datetime:
                    pickup = t.actual_pickup_datetime.strftime('%Y-%m-%d %H:%M')
                if t.actual_delivery_datetime:
                    delivery = t.actual_delivery_datetime.strftime('%Y-%m-%d %H:%M')
                if t.actual_pickup_datetime and t.actual_delivery_datetime:
                    hrs = round(
                        (t.actual_delivery_datetime - t.actual_pickup_datetime).total_seconds() / 3600, 1
                    )
            except Exception:
                pass
            rows.append([
                j.id, f"{j.pickup_location} → {j.destination}",
                j.cargo_description, float(j.estimated_cargo_weight_kg or 0),
                j.status,
                j.required_pickup_datetime.strftime('%Y-%m-%d %H:%M') if j.required_pickup_datetime else '',
                pickup, delivery, hrs,
            ])
        return f'Transporter Jobs Report — {transporter}', headers, rows, 'transporter_jobs_report'

    @staticmethod
    def _route_performance_rows(transporter, date_from=None, date_to=None):
        """Per-route on-time rate + avg transit hours — shared by the standalone Performance
        Report and as the summary section appended to the Complete Activity Report."""
        from apps.transport.models import TransportRequest

        qs = TransportRequest.objects.filter(transporter=transporter)
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        routes: dict = {}
        for j in qs:
            route = f"{j.pickup_location} → {j.destination}"
            try:
                t = j.trip
                if t.actual_pickup_datetime and t.actual_delivery_datetime:
                    hrs = (t.actual_delivery_datetime - t.actual_pickup_datetime).total_seconds() / 3600
                    on_time = 1 if hrs <= 4.5 else 0
                    routes.setdefault(route, {'count': 0, 'on_time': 0, 'total_hrs': 0.0})
                    routes[route]['count'] += 1
                    routes[route]['on_time'] += on_time
                    routes[route]['total_hrs'] += hrs
            except Exception:
                pass

        headers = ['Route', 'Total Jobs', 'On-Time Deliveries', 'On-Time Rate (%)', 'Avg Transit Hrs']
        rows = [
            [
                route,
                d['count'],
                d['on_time'],
                round(d['on_time'] / d['count'] * 100, 1) if d['count'] else 0,
                round(d['total_hrs'] / d['count'], 1) if d['count'] else 0,
            ]
            for route, d in sorted(routes.items())
        ]
        return headers, rows

    def _trans_performance(self, request):
        try:
            transporter = request.user.transporter_profile
        except Exception:
            return Response({'detail': 'No transporter profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._route_performance_rows(transporter, date_from, date_to)
        return f'Transporter Performance Report — {transporter}', headers, rows, 'transporter_performance_report'

    def _trans_complete(self, request):
        from apps.transport.models import TransportRequest
        try:
            transporter = request.user.transporter_profile
        except Exception:
            return Response({'detail': 'No transporter profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = TransportRequest.objects.filter(transporter=transporter).select_related(
            'requested_by_cooperative', 'requested_by_distributor', 'vehicle',
        )
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        headers = [
            'Job ID', 'Requested By', 'Route', 'Cargo', 'Weight (kg)', 'Vehicle', 'Status',
            'Required Pickup', 'Actual Pickup', 'Delivered', 'Transit Hrs', 'Incidents',
        ]
        rows = []
        for j in qs:
            requester = (
                j.requested_by_cooperative.name if j.requested_by_cooperative
                else (j.requested_by_distributor.company_name if j.requested_by_distributor else '')
            )
            vehicle = f'{j.vehicle.plate_number}' if j.vehicle else ''
            pickup = delivery = hrs = ''
            incidents = 0
            try:
                t = j.trip
                if t.actual_pickup_datetime:
                    pickup = t.actual_pickup_datetime.strftime('%Y-%m-%d %H:%M')
                if t.actual_delivery_datetime:
                    delivery = t.actual_delivery_datetime.strftime('%Y-%m-%d %H:%M')
                if t.actual_pickup_datetime and t.actual_delivery_datetime:
                    hrs = round((t.actual_delivery_datetime - t.actual_pickup_datetime).total_seconds() / 3600, 1)
                incidents = t.incident_reports.count()
            except Exception:
                pass
            rows.append([
                j.id, requester, f"{j.pickup_location} → {j.destination}",
                j.cargo_description, float(j.estimated_cargo_weight_kg or 0), vehicle,
                j.status,
                j.required_pickup_datetime.strftime('%Y-%m-%d %H:%M') if j.required_pickup_datetime else '',
                pickup, delivery, hrs, incidents,
            ])

        perf_headers, perf_rows = self._route_performance_rows(transporter, date_from, date_to)
        extra_sections = [('Delivery Performance by Route', perf_headers, perf_rows)]

        # Incidents reported — covers the "Fleet Monitoring" nav section, which otherwise
        # only shows up here as a bare count on the main table.
        from apps.transport.models import IncidentReport
        from django.db.models import Q
        incident_qs = IncidentReport.objects.filter(
            Q(trip__transport_request__transporter=transporter) |
            Q(trip__transport_request__transporter__parent_company=transporter)
        ).select_related('trip__transport_request')
        if date_from:
            incident_qs = incident_qs.filter(reported_at__gte=date_from)
        if date_to:
            incident_qs = incident_qs.filter(reported_at__lte=date_to)
        incident_headers = ['Trip', 'Route', 'Type', 'Description', 'Resolved', 'Reported On']
        incident_rows = [
            [
                i.trip_id,
                f"{i.trip.transport_request.pickup_location} → {i.trip.transport_request.destination}",
                i.get_incident_type_display(),
                i.description,
                'Yes' if i.resolved else 'No',
                i.reported_at.strftime('%Y-%m-%d %H:%M') if i.reported_at else '',
            ]
            for i in incident_qs
        ]
        extra_sections.append(('Incidents Reported', incident_headers, incident_rows))

        # My Drivers roster — company accounts only (an individual driver has no sub-drivers).
        if transporter.parent_company_id is None:
            drivers = transporter.drivers.select_related('user')
            if drivers.exists():
                driver_headers = ['Driver', 'Phone', 'Base Location', 'Operating Districts', 'Active', 'Vehicles']
                driver_rows = [
                    [
                        d.user.get_full_name(), d.user.phone_number or '', d.base_location or '',
                        ', '.join(d.operating_districts or []), 'Yes' if d.is_active else 'Suspended',
                        d.vehicles.count(),
                    ]
                    for d in drivers
                ]
                extra_sections.append(('My Drivers', driver_headers, driver_rows))

        return f'Complete Activity Report — {transporter}', headers, rows, 'transporter_complete_report', extra_sections

    # ── Distributor ─────────────────────────────────────────────────────────

    def _dist_orders(self, request):
        from apps.distribution.models import Order
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = Order.objects.filter(distributor=dist).select_related(
            'market_agent__user', 'collection_notice__crop'
        )
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        headers = [
            'Order ID', 'Crop', 'Market Agent', 'Requested (kg)',
            'Confirmed (kg)', 'Method', 'Status', 'Created',
        ]
        rows = []
        for o in qs:
            crop = o.collection_notice.crop.name if o.collection_notice and o.collection_notice.crop else ''
            agent = o.market_agent.user.get_full_name() if o.market_agent else ''
            rows.append([
                o.id, crop, agent,
                float(o.quantity_requested_kg or 0), float(o.confirmed_quantity_kg or 0),
                o.delivery_method, o.status,
                o.created_at.strftime('%Y-%m-%d') if o.created_at else '',
            ])
        return f'Distributor Orders Report — {dist}', headers, rows, 'distributor_orders_report'

    def _dist_delivery_comparison(self, request):
        from apps.distribution.models import Order
        from apps.traceability.models import Batch
        from apps.cooperatives.models import Crop
        from django.db.models import Sum, Count, Avg, Q, FloatField, ExpressionWrapper, F
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)

        # ── Part 1: Delivery method summary with loss rates ─────────────────
        headers = [
            'Delivery Method', 'Total Orders', 'Completed Orders',
            'Cancelled / Declined', 'Total Volume (kg)',
            'Avg Transit Loss (%)', 'Avg Spoilage Loss (%)',
        ]
        rows = []
        for method in ['SELF_COLLECTION', 'TRANSPORTER_DELIVERY']:
            qs = Order.objects.filter(distributor=dist, delivery_method=method)
            if date_from:
                qs = qs.filter(created_at__gte=date_from)
            if date_to:
                qs = qs.filter(created_at__lte=date_to)
            agg = qs.aggregate(
                total=Count('id'),
                completed=Count('id', filter=Q(status='COMPLETED')),
                cancelled=Count('id', filter=Q(status__in=['DECLINED', 'CANCELLED'])),
                volume=Sum('confirmed_quantity_kg'),
            )
            # Loss rates from linked batches
            batches = Batch.objects.filter(
                received_by_distributor=dist,
                transport_request_leg2__isnull=(method == 'SELF_COLLECTION'),
            )
            if date_from:
                batches = batches.filter(dispatch_timestamp__gte=date_from)
            if date_to:
                batches = batches.filter(dispatch_timestamp__lte=date_to)
            loss_agg = batches.aggregate(
                avg_transit=Avg('transit_loss_leg1_pct'),
                avg_spoilage=Avg('market_spoilage_loss_pct'),
            )
            rows.append([
                'Self-Collection' if method == 'SELF_COLLECTION' else 'Transporter Delivery',
                agg['total'],
                agg['completed'],
                agg['cancelled'],
                round(float(agg['volume'] or 0), 1),
                round(float(loss_agg['avg_transit'] or 0), 2),
                round(float(loss_agg['avg_spoilage'] or 0), 2),
            ])

        # ── Part 2: Crop-level loss breakdown ───────────────────────────────
        crop_headers = ['Crop', 'Batches Received', 'Avg Transit Loss (%)', 'Avg Spoilage (%)', 'Total Loss (kg)']
        all_batches = Batch.objects.filter(received_by_distributor=dist).select_related('crop')
        if date_from:
            all_batches = all_batches.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            all_batches = all_batches.filter(dispatch_timestamp__lte=date_to)
        crop_data = {}
        for b in all_batches:
            name = b.crop.name if b.crop else 'Unknown'
            if name not in crop_data:
                crop_data[name] = {'count': 0, 'transit': [], 'spoilage': [], 'total_loss_kg': 0}
            crop_data[name]['count'] += 1
            if b.transit_loss_leg1_pct: crop_data[name]['transit'].append(float(b.transit_loss_leg1_pct))
            if b.market_spoilage_loss_pct: crop_data[name]['spoilage'].append(float(b.market_spoilage_loss_pct))
            if b.total_loss_kg: crop_data[name]['total_loss_kg'] += float(b.total_loss_kg)

        crop_rows = [
            [
                crop,
                d['count'],
                round(sum(d['transit']) / len(d['transit']), 2) if d['transit'] else 0,
                round(sum(d['spoilage']) / len(d['spoilage']), 2) if d['spoilage'] else 0,
                round(d['total_loss_kg'], 1),
            ]
            for crop, d in sorted(crop_data.items(), key=lambda x: -x[1]['total_loss_kg'])
        ]

        extra_sections = [
            ('Crop-Level Loss Breakdown', crop_headers, crop_rows),
        ]

        # This report is two summary rows, not a row-per-record dump — a bar chart of the
        # actual question the report exists to answer ("which delivery method loses more
        # produce?") reads instantly; a 2-row table doesn't.
        chart_spec = {
            'title': 'Avg Loss (%) by Delivery Method',
            'categories': [r[0] for r in rows],
            'series': [
                {'name': 'Avg Transit Loss (%)', 'values': [r[5] for r in rows]},
                {'name': 'Avg Spoilage Loss (%)', 'values': [r[6] for r in rows]},
            ],
        }

        return (
            f'Distributor Delivery Method Analysis — {dist}', headers, rows,
            'distributor_delivery_comparison_report', extra_sections, chart_spec,
        )

    @staticmethod
    def _dist_waste_rows(dist, date_from=None, date_to=None):
        from apps.distribution.models import DistributorWasteReport
        qs = DistributorWasteReport.objects.filter(distributor=dist)
        if date_from:
            qs = qs.filter(reporting_period_end__gte=date_from)
        if date_to:
            qs = qs.filter(reporting_period_start__lte=date_to)
        headers = [
            'Period Start', 'Period End', 'Moved On (kg)', 'Discarded (kg)',
            'Discard Reason', 'Warehouse Spoilage Loss (%)',
        ]
        rows = [
            [
                w.reporting_period_start.strftime('%Y-%m-%d') if w.reporting_period_start else '',
                w.reporting_period_end.strftime('%Y-%m-%d') if w.reporting_period_end else '',
                float(w.quantity_moved_kg or 0),
                float(w.quantity_discarded_kg or 0),
                w.discard_reason,
                float(w.warehouse_spoilage_loss_pct or 0),
            ]
            for w in qs.order_by('-reporting_period_end')
        ]
        return headers, rows

    def _dist_waste(self, request):
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._dist_waste_rows(dist, date_from, date_to)
        return f'Distributor Warehouse Waste Report — {dist}', headers, rows, 'distributor_waste_report'

    @staticmethod
    def _coop_waste_rows(coop, date_from=None, date_to=None):
        from apps.cooperatives.models import CooperativeWasteReport
        qs = CooperativeWasteReport.objects.filter(cooperative=coop).select_related('crop')
        if date_from:
            qs = qs.filter(reporting_period_end__gte=date_from)
        if date_to:
            qs = qs.filter(reporting_period_start__lte=date_to)
        headers = [
            'Period Start', 'Period End', 'Crop', 'Dispatched (kg)', 'Discarded (kg)',
            'Discard Reason', 'Storage Spoilage Loss (%)',
        ]
        rows = [
            [
                w.reporting_period_start.strftime('%Y-%m-%d') if w.reporting_period_start else '',
                w.reporting_period_end.strftime('%Y-%m-%d') if w.reporting_period_end else '',
                w.crop.name if w.crop_id else '',
                float(w.quantity_dispatched_kg or 0),
                float(w.quantity_discarded_kg or 0),
                w.discard_reason,
                float(w.storage_spoilage_loss_pct or 0),
            ]
            for w in qs.order_by('-reporting_period_end')
        ]
        return headers, rows

    @staticmethod
    def _coop_produce_requests_received_rows(coop, date_from=None, date_to=None):
        from apps.distribution.models import ProduceRequest
        qs = ProduceRequest.objects.filter(cooperative=coop).select_related('distributor__user', 'crop')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        headers = [
            'Request ID', 'Distributor', 'Crop', 'Quantity (kg)', 'Grade Required',
            'Delivery Method', 'Required By', 'Status', 'Received On',
        ]
        rows = [
            [
                r.id, str(r.distributor), r.crop.name, float(r.quantity_kg),
                r.quality_grade_required, r.get_delivery_method_display(),
                r.required_delivery_date.strftime('%Y-%m-%d') if r.required_delivery_date else '',
                r.get_status_display(),
                r.created_at.strftime('%Y-%m-%d') if r.created_at else '',
            ]
            for r in qs
        ]
        return headers, rows

    def _coop_waste(self, request):
        try:
            coop = request.user.cooperative
        except Exception:
            return Response({'detail': 'No cooperative profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._coop_waste_rows(coop, date_from, date_to)
        return f'Cooperative Pre-Dispatch Waste Report — {coop}', headers, rows, 'cooperative_waste_report'

    def _national_waste(self, request):
        """
        Every waste report across all three stages (cooperative pre-dispatch, distributor
        warehouse, market agent stall), in one export — the national-scope view MINAGRI/Admin
        need since (unlike Cooperative/Distributor/Market Agent) they aren't scoped to one org.
        """
        from apps.cooperatives.models import CooperativeWasteReport
        from apps.distribution.models import DistributorWasteReport
        from apps.market_agents.models import WasteReport as MarketAgentWasteReport

        date_from, date_to = self._parse_date_range(request)

        def in_range(qs):
            if date_from:
                qs = qs.filter(reporting_period_end__gte=date_from)
            if date_to:
                qs = qs.filter(reporting_period_start__lte=date_to)
            return qs

        headers = [
            'Stage', 'Organisation', 'Period Start', 'Period End', 'Crop',
            'Discarded (kg)', 'Discard Reason', 'Loss (%)',
        ]
        rows = []
        for w in in_range(CooperativeWasteReport.objects.select_related('cooperative', 'crop')):
            rows.append([
                'Cooperative (pre-dispatch)', str(w.cooperative),
                w.reporting_period_start.strftime('%Y-%m-%d') if w.reporting_period_start else '',
                w.reporting_period_end.strftime('%Y-%m-%d') if w.reporting_period_end else '',
                w.crop.name if w.crop_id else '', float(w.quantity_discarded_kg or 0),
                w.discard_reason, float(w.storage_spoilage_loss_pct or 0),
            ])
        for w in in_range(DistributorWasteReport.objects.select_related('distributor', 'crop')):
            rows.append([
                'Distributor (warehouse)', str(w.distributor),
                w.reporting_period_start.strftime('%Y-%m-%d') if w.reporting_period_start else '',
                w.reporting_period_end.strftime('%Y-%m-%d') if w.reporting_period_end else '',
                w.crop.name if w.crop_id else '', float(w.quantity_discarded_kg or 0),
                w.discard_reason, float(w.warehouse_spoilage_loss_pct or 0),
            ])
        for w in in_range(MarketAgentWasteReport.objects.select_related('market_agent', 'crop')):
            rows.append([
                'Market Agent (stall)', str(w.market_agent),
                w.reporting_period_start.strftime('%Y-%m-%d') if w.reporting_period_start else '',
                w.reporting_period_end.strftime('%Y-%m-%d') if w.reporting_period_end else '',
                w.crop.name if w.crop_id else '', float(w.quantity_discarded_kg or 0),
                w.discard_reason, float(w.market_spoilage_loss_pct or 0),
            ])
        rows.sort(key=lambda r: r[3], reverse=True)  # newest period end first
        return 'National Waste & Spoilage Report — All Stages', headers, rows, 'national_waste_report'

    def _dist_complete(self, request):
        from apps.distribution.models import Order
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = Order.objects.filter(distributor=dist).select_related(
            'market_agent__user', 'collection_notice__crop', 'transporter',
        ).prefetch_related('collection_confirmations', 'batch__cooperative')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)

        headers = [
            'Order ID', 'Crop', 'Cooperative (Origin)', 'Market Agent', 'Requested (kg)',
            'Confirmed (kg)', 'Method', 'Transporter', 'Collected (kg)', 'Arrived (kg)',
            'Status', 'Created',
        ]
        rows = []
        for o in qs:
            crop = o.collection_notice.crop.name if o.collection_notice and o.collection_notice.crop else ''
            agent = o.market_agent.user.get_full_name() if o.market_agent else ''
            batch = next(iter(o.batch.all()), None)
            confirmation = next(iter(o.collection_confirmations.all()), None)
            rows.append([
                o.id, crop, batch.cooperative.name if batch else '', agent,
                float(o.quantity_requested_kg or 0), float(o.confirmed_quantity_kg or 0),
                o.delivery_method, o.transporter.company_name if o.transporter else '',
                float(confirmation.quantity_collected_kg) if confirmation else '',
                float(confirmation.quantity_arrived_at_stall_kg) if confirmation else '',
                o.status,
                o.created_at.strftime('%Y-%m-%d') if o.created_at else '',
            ])
        req_headers, req_rows = self._dist_produce_request_rows(dist, date_from, date_to)
        receipt_headers, receipt_rows = self._dist_receipt_rows(dist, date_from, date_to)
        mismatch_headers, mismatch_rows = self._dist_mismatch_rows(dist, date_from, date_to)
        waste_headers, waste_rows = self._dist_waste_rows(dist, date_from, date_to)

        from apps.distribution.models import DistributorMarketAgentLink
        link_qs = DistributorMarketAgentLink.objects.filter(distributor=dist).select_related('market_agent__user')
        if date_from:
            link_qs = link_qs.filter(linked_at__gte=date_from)
        if date_to:
            link_qs = link_qs.filter(linked_at__lte=date_to)
        link_headers = ['Market Agent', 'Phone', 'Active Link', 'Linked On', 'Notes']
        link_rows = [
            [
                l.market_agent.user.get_full_name(), l.market_agent.user.phone_number or '',
                'Yes' if l.is_active else 'No',
                l.linked_at.strftime('%Y-%m-%d') if l.linked_at else '', (l.notes or '')[:80],
            ]
            for l in link_qs
        ]

        extra_sections = [
            ('Produce Requests to Cooperatives', req_headers, req_rows),
            ('Confirmed Batch Receipts', receipt_headers, receipt_rows),
            ('Mismatches Reported', mismatch_headers, mismatch_rows),
            ('Linked Market Agents', link_headers, link_rows),
            ('Warehouse Waste', waste_headers, waste_rows),
        ]
        return f'Complete Activity Report — {dist}', headers, rows, 'distributor_complete_report', extra_sections

    @staticmethod
    def _dist_produce_request_rows(dist, date_from=None, date_to=None):
        from apps.distribution.models import ProduceRequest
        qs = ProduceRequest.objects.filter(distributor=dist).select_related('cooperative', 'crop')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        headers = [
            'Request ID', 'Cooperative', 'Crop', 'Quantity (kg)', 'Grade Required',
            'Delivery Method', 'Required By', 'Status', 'Created',
        ]
        rows = [
            [
                r.id, r.cooperative.name, r.crop.name, float(r.quantity_kg),
                r.quality_grade_required, r.get_delivery_method_display(),
                r.required_delivery_date.strftime('%Y-%m-%d') if r.required_delivery_date else '',
                r.get_status_display(),
                r.created_at.strftime('%Y-%m-%d') if r.created_at else '',
            ]
            for r in qs
        ]
        return headers, rows

    @staticmethod
    def _dist_receipt_rows(dist, date_from=None, date_to=None):
        from apps.traceability.models import Batch
        qs = Batch.objects.filter(
            received_by_distributor=dist, distributor_receipt_timestamp__isnull=False,
        ).select_related('crop', 'cooperative', 'supply_agreement')
        if date_from:
            qs = qs.filter(distributor_receipt_timestamp__gte=date_from)
        if date_to:
            qs = qs.filter(distributor_receipt_timestamp__lte=date_to)
        headers = [
            'Batch ID', 'Cooperative', 'Crop', 'Ordered (kg)', 'Dispatched (kg)', 'Received (kg)',
            'Quality Received', 'Transit Loss (%)', 'Mismatch Reported', 'Received On',
        ]
        rows = [
            [
                str(b.batch_id)[:8], b.cooperative.name, b.crop.name,
                float(b.supply_agreement.agreed_quantity_kg) if b.supply_agreement_id else '—',
                float(b.dispatch_weight_kg or 0), float(b.weight_at_distributor_kg or 0),
                b.quality_at_distributor or '—',
                float(b.transit_loss_leg1_pct or 0),
                'Yes' if b.mismatch_reported else 'No',
                b.distributor_receipt_timestamp.strftime('%Y-%m-%d') if b.distributor_receipt_timestamp else '',
            ]
            for b in qs
        ]
        return headers, rows

    @staticmethod
    def _dist_mismatch_rows(dist, date_from=None, date_to=None):
        from apps.traceability.models import Batch
        qs = Batch.objects.filter(
            received_by_distributor=dist, mismatch_reported=True,
        ).select_related('crop', 'cooperative')
        if date_from:
            qs = qs.filter(mismatch_reported_at__gte=date_from)
        if date_to:
            qs = qs.filter(mismatch_reported_at__lte=date_to)
        headers = [
            'Batch ID', 'Cooperative', 'Expected Crop', 'Dispatched (kg)',
            'Description', 'Notes', 'Reported On',
        ]
        rows = [
            [
                str(b.batch_id)[:8], b.cooperative.name, b.crop.name,
                float(b.dispatch_weight_kg or 0),
                b.mismatch_description, b.mismatch_notes,
                b.mismatch_reported_at.strftime('%Y-%m-%d') if b.mismatch_reported_at else '',
            ]
            for b in qs
        ]
        return headers, rows

    def _dist_requests(self, request):
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._dist_produce_request_rows(dist, date_from, date_to)
        return f'Produce Requests Report — {dist}', headers, rows, 'distributor_produce_requests_report'

    def _dist_receipts(self, request):
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._dist_receipt_rows(dist, date_from, date_to)
        return f'Confirmed Receipts Report — {dist}', headers, rows, 'distributor_receipts_report'

    def _dist_mismatches(self, request):
        try:
            dist = request.user.distributor_profile
        except Exception:
            return Response({'detail': 'No distributor profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._dist_mismatch_rows(dist, date_from, date_to)
        return f'Mismatches Reported Report — {dist}', headers, rows, 'distributor_mismatches_report'

    # ── Market Agent ────────────────────────────────────────────────────────

    def _agent_collections(self, request):
        from apps.market_agents.models import CollectionConfirmation
        try:
            agent = request.user.market_agent_profile
        except Exception:
            return Response({'detail': 'No market agent profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = CollectionConfirmation.objects.filter(market_agent=agent).select_related(
            'order__collection_notice__crop'
        )
        if date_from:
            qs = qs.filter(collected_at__gte=date_from)
        if date_to:
            qs = qs.filter(collected_at__lte=date_to)

        headers = ['Date', 'Crop', 'Collected (kg)', 'Arrived (kg)', 'Loss (kg)', 'Loss (%)']
        rows = []
        for c in qs:
            crop = (
                c.order.collection_notice.crop.name
                if c.order and c.order.collection_notice and c.order.collection_notice.crop
                else ''
            )
            rows.append([
                c.collected_at.strftime('%Y-%m-%d') if c.collected_at else '',
                crop,
                float(c.quantity_collected_kg or 0),
                float(c.quantity_arrived_at_stall_kg or 0),
                float(c.self_transport_loss_kg or 0),
                float(c.self_transport_loss_pct or 0),
            ])
        return f'Market Agent Collections Report — {agent}', headers, rows, 'market_agent_collections_report'

    @staticmethod
    def _agent_waste_rows(agent, date_from=None, date_to=None):
        from apps.market_agents.models import WasteReport
        qs = WasteReport.objects.filter(market_agent=agent)
        if date_from:
            qs = qs.filter(reporting_period_end__gte=date_from)
        if date_to:
            qs = qs.filter(reporting_period_start__lte=date_to)
        headers = [
            'Period Start', 'Period End', 'Sold (kg)', 'Discarded (kg)',
            'Discard Reason', 'Spoilage Loss (%)',
        ]
        rows = [
            [
                w.reporting_period_start.strftime('%Y-%m-%d') if w.reporting_period_start else '',
                w.reporting_period_end.strftime('%Y-%m-%d') if w.reporting_period_end else '',
                float(w.quantity_sold_kg or 0),
                float(w.quantity_discarded_kg or 0),
                w.discard_reason,
                float(w.market_spoilage_loss_pct or 0),
            ]
            for w in qs.order_by('-reporting_period_end')
        ]
        return headers, rows

    def _agent_waste(self, request):
        try:
            agent = request.user.market_agent_profile
        except Exception:
            return Response({'detail': 'No market agent profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._agent_waste_rows(agent, date_from, date_to)
        return f'Market Agent Waste Report — {agent}', headers, rows, 'market_agent_waste_report'

    def _agent_complete(self, request):
        from apps.market_agents.models import CollectionConfirmation
        try:
            agent = request.user.market_agent_profile
        except Exception:
            return Response({'detail': 'No market agent profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        qs = CollectionConfirmation.objects.filter(market_agent=agent).select_related(
            'order__collection_notice__crop', 'order__distributor', 'order__transporter',
        )
        if date_from:
            qs = qs.filter(collected_at__gte=date_from)
        if date_to:
            qs = qs.filter(collected_at__lte=date_to)

        headers = [
            'Date', 'Crop', 'Distributor', 'Method', 'Price/kg (RWF)',
            'Collected (kg)', 'Arrived (kg)', 'Loss (kg)', 'Loss (%)', 'Order Status',
        ]
        rows = []
        for c in qs:
            o = c.order
            crop = o.collection_notice.crop.name if o and o.collection_notice and o.collection_notice.crop else ''
            distributor = o.distributor.company_name if o and o.distributor else ''
            price = o.collection_notice.price_per_kg if o and o.collection_notice else None
            rows.append([
                c.collected_at.strftime('%Y-%m-%d') if c.collected_at else '',
                crop, distributor,
                o.delivery_method if o else '',
                float(price) if price is not None else '',
                float(c.quantity_collected_kg or 0),
                float(c.quantity_arrived_at_stall_kg or 0),
                float(c.self_transport_loss_kg or 0),
                float(c.self_transport_loss_pct or 0),
                o.status if o else '',
            ])
        waste_headers, waste_rows = self._agent_waste_rows(agent, date_from, date_to)
        extra_sections = [('Waste Reports Submitted', waste_headers, waste_rows)]
        return f'Complete Activity Report — {agent}', headers, rows, 'market_agent_complete_report', extra_sections

    def _agent_loss_summary(self, request):
        from apps.market_agents.models import CollectionConfirmation, WasteReport
        from django.db.models import Avg
        try:
            agent = request.user.market_agent_profile
        except Exception:
            return Response({'detail': 'No market agent profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        all_collections = CollectionConfirmation.objects.filter(market_agent=agent).select_related(
            'order__collection_notice__crop'
        )
        waste_qs = WasteReport.objects.filter(market_agent=agent)
        if date_from:
            all_collections = all_collections.filter(collected_at__gte=date_from)
            waste_qs = waste_qs.filter(reporting_period_end__gte=date_from)
        if date_to:
            all_collections = all_collections.filter(collected_at__lte=date_to)
            waste_qs = waste_qs.filter(reporting_period_start__lte=date_to)
        avg_loss = all_collections.aggregate(avg=Avg('self_transport_loss_pct'))['avg'] or 0
        avg_waste = waste_qs.aggregate(avg=Avg('market_spoilage_loss_pct'))['avg'] or 0

        high_risk = (
            all_collections
            .filter(self_transport_loss_pct__gt=5)
            .order_by('-self_transport_loss_pct')
        )

        headers = [
            'Date', 'Crop', 'Collected (kg)', 'Arrived (kg)', 'Loss (kg)', 'Loss (%)',
        ]
        rows = []
        for c in high_risk:
            crop = (
                c.order.collection_notice.crop.name
                if c.order and c.order.collection_notice and c.order.collection_notice.crop
                else ''
            )
            rows.append([
                c.collected_at.strftime('%Y-%m-%d') if c.collected_at else '',
                crop,
                float(c.quantity_collected_kg or 0),
                float(c.quantity_arrived_at_stall_kg or 0),
                float(c.self_transport_loss_kg or 0),
                float(c.self_transport_loss_pct or 0),
            ])

        title = (
            f'Loss Summary — {agent} | '
            f'Avg collection loss: {avg_loss:.1f}% | '
            f'Avg waste rate: {avg_waste:.1f}% | '
            f'High-risk collections (>5% loss): {len(rows)}'
        )
        return title, headers, rows, 'market_agent_loss_summary_report'

    # ── MINAGRI / Admin ─────────────────────────────────────────────────────

    def _national(self, request):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Sum, Count

        date_from, date_to = self._parse_date_range(request)
        base_qs = Batch.objects.filter(total_loss_pct__isnull=False)
        if date_from:
            base_qs = base_qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            base_qs = base_qs.filter(dispatch_timestamp__lte=date_to)

        rows = [
            [
                r['cooperative__district'] or 'Unknown',
                r['crop__name'] or 'Unknown',
                r['batches'],
                round(float(r['volume_kg'] or 0), 2),
                round(float(r['avg_loss_pct'] or 0), 2),
                round(float(r['loss_kg'] or 0), 2),
            ]
            for r in (
                base_qs
                .values('cooperative__district', 'crop__name')
                .annotate(
                    batches=Count('id'),
                    volume_kg=Sum('dispatch_weight_kg'),
                    avg_loss_pct=Avg('total_loss_pct'),
                    loss_kg=Sum('total_loss_kg'),
                )
                .order_by('cooperative__district', '-avg_loss_pct')
            )
        ]
        headers = ['District', 'Crop', 'Batch Count', 'Volume (kg)', 'Avg Loss (%)', 'Total Loss (kg)']
        return 'National Supply Chain Report', headers, rows, 'national_supply_chain_report'

    def _national_districts(self, request):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Sum, Count

        date_from, date_to = self._parse_date_range(request)
        base_qs = Batch.objects.filter(total_loss_pct__isnull=False)
        if date_from:
            base_qs = base_qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            base_qs = base_qs.filter(dispatch_timestamp__lte=date_to)

        rows = [
            [
                r['cooperative__district'] or 'Unknown',
                r['batches'],
                round(float(r['volume_kg'] or 0), 2),
                round(float(r['avg_loss'] or 0), 2),
                round(float(r['total_loss'] or 0), 2),
                'HIGH' if float(r['avg_loss'] or 0) >= 12 else ('MEDIUM' if float(r['avg_loss'] or 0) >= 7 else 'LOW'),
            ]
            for r in (
                base_qs
                .values('cooperative__district')
                .annotate(
                    batches=Count('id'),
                    volume_kg=Sum('dispatch_weight_kg'),
                    avg_loss=Avg('total_loss_pct'),
                    total_loss=Sum('total_loss_kg'),
                )
                .order_by('-avg_loss')
            )
            if r['cooperative__district']
        ]
        headers = ['District', 'Batch Count', 'Volume (kg)', 'Avg Loss (%)', 'Total Loss (kg)', 'Risk Level']

        # This report is a ranking — "which districts lose the most produce?" — so the top
        # offenders read instantly as a chart; a full table is still available as CSV.
        top = sorted(rows, key=lambda r: -r[3])[:10]
        chart_spec = {
            'title': 'Avg Loss (%) by District (top 10)',
            'categories': [r[0] for r in top],
            'series': [{'name': 'Avg Loss (%)', 'values': [r[3] for r in top]}],
        }
        return 'National District Loss Report', headers, rows, 'national_districts_report', None, chart_spec

    def _national_crops(self, request):
        from apps.traceability.models import Batch
        from django.db.models import Avg, Sum, Count

        date_from, date_to = self._parse_date_range(request)
        base_qs = Batch.objects.filter(total_loss_pct__isnull=False)
        if date_from:
            base_qs = base_qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            base_qs = base_qs.filter(dispatch_timestamp__lte=date_to)
        # Optional filters — used by the MINAGRI Custom Reports builder so its PDF/CSV
        # export matches exactly what the live preview showed.
        crop = request.query_params.get('crop')
        if crop and crop != 'All':
            base_qs = base_qs.filter(crop__name__iexact=crop)
        district = request.query_params.get('district')
        if district and district != 'All':
            base_qs = base_qs.filter(cooperative__district__iexact=district)

        rows = [
            [
                r['crop__name'] or 'Unknown',
                r['batches'],
                round(float(r['volume_kg'] or 0), 2),
                round(float(r['avg_loss'] or 0), 2),
                round(float(r['total_loss'] or 0), 2),
            ]
            for r in (
                base_qs
                .values('crop__name')
                .annotate(
                    batches=Count('id'),
                    volume_kg=Sum('dispatch_weight_kg'),
                    avg_loss=Avg('total_loss_pct'),
                    total_loss=Sum('total_loss_kg'),
                )
                .order_by('-avg_loss')
            )
        ]
        headers = ['Crop', 'Batch Count', 'Volume (kg)', 'Avg Loss (%)', 'Total Loss (kg)']

        # Same reasoning as the district report — a ranking reads better as a chart of the
        # worst offenders than as a full table.
        top = sorted(rows, key=lambda r: -r[3])[:10]
        chart_spec = {
            'title': 'Avg Loss (%) by Crop (top 10)',
            'categories': [r[0] for r in top],
            'series': [{'name': 'Avg Loss (%)', 'values': [r[3] for r in top]}],
        }
        return 'National Crop Loss Report', headers, rows, 'national_crops_report', None, chart_spec

    def _national_transport(self, request):
        from apps.transport.models import TransportRequest, Trip
        from django.db.models import Count

        date_from, date_to = self._parse_date_range(request)

        headers = ['Route', 'Total Jobs', 'Completed', 'Avg Transit Hrs', 'Avg Delay Hrs']
        routes: dict = {}

        trip_qs = Trip.objects.filter(
            actual_pickup_datetime__isnull=False,
            actual_delivery_datetime__isnull=False,
        ).select_related('transport_request')
        if date_from:
            trip_qs = trip_qs.filter(actual_pickup_datetime__gte=date_from)
        if date_to:
            trip_qs = trip_qs.filter(actual_pickup_datetime__lte=date_to)

        for trip in trip_qs:
            req = trip.transport_request
            route = f"{req.pickup_location} → {req.destination}"
            hrs = (trip.actual_delivery_datetime - trip.actual_pickup_datetime).total_seconds() / 3600
            routes.setdefault(route, {'total': 0, 'hrs': 0.0})
            routes[route]['total'] += 1
            routes[route]['hrs'] += hrs

        completed_qs = TransportRequest.objects.filter(status='COMPLETED')
        if date_from:
            completed_qs = completed_qs.filter(created_at__gte=date_from)
        if date_to:
            completed_qs = completed_qs.filter(created_at__lte=date_to)

        completed_counts = {}
        for j in completed_qs:
            key = f"{j.pickup_location} → {j.destination}"
            completed_counts[key] = completed_counts.get(key, 0) + 1

        rows = []
        for route, d in sorted(routes.items()):
            avg_hrs = round(d['hrs'] / d['total'], 1) if d['total'] else 0
            rows.append([
                route,
                d['total'],
                completed_counts.get(route, 0),
                avg_hrs,
                round(max(0, avg_hrs - 4.0), 1),
            ])

        # Busiest routes by job count read instantly as a chart; the full per-route table
        # (which can run to dozens of rows) stays available as CSV.
        top = sorted(rows, key=lambda r: -r[1])[:10]
        chart_spec = {
            'title': 'Busiest Routes (top 10 by job count)',
            'categories': [r[0] for r in top],
            'series': [{'name': 'Total Jobs', 'values': [r[1] for r in top]}],
        }
        return 'National Transport Performance Report', headers, rows, 'national_transport_report', None, chart_spec

    def _national_complete(self, request):
        from apps.traceability.models import Batch

        date_from, date_to = self._parse_date_range(request)
        qs = Batch.objects.all()
        if date_from:
            qs = qs.filter(dispatch_timestamp__gte=date_from)
        if date_to:
            qs = qs.filter(dispatch_timestamp__lte=date_to)

        headers, rows = self._batch_complete_rows(qs, include_origin=True)
        return 'National Complete Activity Report', headers, rows, 'national_complete_report'

    # ── Admin ────────────────────────────────────────────────────────────────

    @staticmethod
    def _admin_user_rows(date_from=None, date_to=None):
        from apps.authentication.models import User
        qs = User.objects.all().order_by('role', 'first_name')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        headers = ['Name', 'Role', 'Email', 'Phone', 'Verified', 'Active', 'Joined']
        rows = [
            [
                u.get_full_name(), u.get_role_display() if hasattr(u, 'get_role_display') else u.role,
                u.email or '', u.phone_number or '',
                'Yes' if u.is_verified else 'No', 'Yes' if u.is_active else 'No',
                u.created_at.strftime('%Y-%m-%d') if getattr(u, 'created_at', None) else '',
            ]
            for u in qs
        ]
        return headers, rows

    def _admin_users(self, request):
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._admin_user_rows(date_from, date_to)
        return 'System Users Report', headers, rows, 'system_users_report'

    def _admin_complete(self, request):
        """
        Admin's own activity report — user management + the registration queue + feedback
        inbox, i.e. what actually shows up under the Admin nav (account/system
        administration), not the MINAGRI national supply-chain report it used to share.
        """
        from apps.authentication.models import AccessRequest
        from apps.feedback.models import Feedback

        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._admin_user_rows(date_from, date_to)

        req_qs = AccessRequest.objects.select_related('reviewed_by')
        if date_from:
            req_qs = req_qs.filter(created_at__gte=date_from)
        if date_to:
            req_qs = req_qs.filter(created_at__lte=date_to)
        req_headers = ['Applicant', 'Role Requested', 'Organisation', 'District', 'Status', 'Reviewed By', 'Submitted On']
        req_rows = [
            [
                r.full_name, r.get_role_requested_display(), r.organization_name, r.district,
                r.get_status_display(), r.reviewed_by.get_full_name() if r.reviewed_by else '',
                r.created_at.strftime('%Y-%m-%d') if r.created_at else '',
            ]
            for r in req_qs
        ]

        fb_qs = Feedback.objects.select_related('user')
        if date_from:
            fb_qs = fb_qs.filter(created_at__gte=date_from)
        if date_to:
            fb_qs = fb_qs.filter(created_at__lte=date_to)
        fb_headers = ['From', 'Role', 'Mode', 'Rating', 'Status', 'Message', 'Submitted On']
        fb_rows = [
            [
                f.user.get_full_name() if f.user else 'Deleted user', f.role,
                f.get_mode_display(), f.rating or '', f.get_status_display(),
                (f.message or '')[:100],
                f.created_at.strftime('%Y-%m-%d') if f.created_at else '',
            ]
            for f in fb_qs
        ]

        extra_sections = [
            ('Registration Requests', req_headers, req_rows),
            ('Feedback & Support Submissions', fb_headers, fb_rows),
        ]
        return 'Complete Activity Report — Admin', headers, rows, 'admin_complete_report', extra_sections

    # ── Warehouse Manager ────────────────────────────────────────────────────

    @staticmethod
    def _warehouse_facility_rows(wm, date_from=None, date_to=None):
        from apps.cooperatives.models import ColdStorageFacility
        qs = ColdStorageFacility.objects.filter(warehouse_manager=wm)
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        headers = [
            'Facility', 'Location', 'Capacity (kg)', 'Available for Rent',
            'Temp Threshold Amber (°C)', 'Temp Threshold Red (°C)', 'Humidity Threshold (%)',
        ]
        rows = [
            [
                f.name, f.location_description or '', float(f.capacity_kg or 0),
                'Yes' if f.is_available_for_rent else 'No',
                float(f.temp_threshold_amber_celsius or 0), float(f.temp_threshold_red_celsius or 0),
                float(f.humidity_threshold_percent or 0),
            ]
            for f in qs
        ]
        return headers, rows

    @staticmethod
    def _warehouse_rental_rows(wm, date_from=None, date_to=None):
        from apps.cooperatives.models import WarehouseRentalRequest
        qs = WarehouseRentalRequest.objects.filter(facility__warehouse_manager=wm).select_related('facility', 'cooperative')
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        headers = ['Facility', 'Requested By (Cooperative)', 'Requested Capacity (kg)', 'Status', 'Requested On', 'Notes']
        rows = [
            [
                r.facility.name if r.facility else '',
                r.cooperative.name if r.cooperative else '',
                float(r.requested_capacity_kg or 0),
                r.status,
                r.created_at.strftime('%Y-%m-%d') if r.created_at else '',
                (r.notes or '')[:80],
            ]
            for r in qs
        ]
        return headers, rows

    def _warehouse_facilities(self, request):
        try:
            wm = request.user.warehouse_manager_profile
        except Exception:
            return Response({'detail': 'No warehouse manager profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._warehouse_facility_rows(wm, date_from, date_to)
        return f'Warehouse Facilities Report — {wm}', headers, rows, 'warehouse_facilities_report'

    def _warehouse_rentals(self, request):
        try:
            wm = request.user.warehouse_manager_profile
        except Exception:
            return Response({'detail': 'No warehouse manager profile linked.'}, status=400)
        date_from, date_to = self._parse_date_range(request)
        headers, rows = self._warehouse_rental_rows(wm, date_from, date_to)
        return f'Warehouse Rental Requests Report — {wm}', headers, rows, 'warehouse_rentals_report'

    def _warehouse_complete(self, request):
        from apps.cooperatives.models import WarehouseRentalRequest
        try:
            wm = request.user.warehouse_manager_profile
        except Exception:
            return Response({'detail': 'No warehouse manager profile linked.'}, status=400)

        date_from, date_to = self._parse_date_range(request)
        # Main table is every facility this warehouse manager owns, not just ones with a
        # rental request — the old version rooted the query at WarehouseRentalRequest, so
        # a brand-new facility with zero requests yet was invisible in its own "complete"
        # report even though "My Facilities" is a whole nav section on its own.
        facility_headers, facility_rows = self._warehouse_facility_rows(wm, date_from, date_to)
        rental_headers, rental_rows = self._warehouse_rental_rows(wm, date_from, date_to)
        extra_sections = [('Rental Requests', rental_headers, rental_rows)]
        return (
            f'Complete Activity Report — {wm}', facility_headers, facility_rows,
            'warehouse_complete_report', extra_sections,
        )

