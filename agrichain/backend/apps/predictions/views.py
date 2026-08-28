from django.db.models import Q
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import LossPrediction
from .serializers import LossPredictionSerializer
from apps.authentication.permissions import IsAnalyticsRole


class LossPredictionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LossPredictionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'COOPERATIVE_MANAGER':
            try:
                qs = LossPrediction.objects.filter(batch__cooperative=user.cooperative)
            except Exception:
                return LossPrediction.objects.none()
        elif user.role == 'DISTRIBUTOR':
            try:
                dist = user.distributor_profile
                qs = LossPrediction.objects.filter(
                    Q(batch__received_by_distributor=dist) | Q(order__distributor=dist)
                ).distinct()
            except Exception:
                return LossPrediction.objects.none()
        elif user.role == 'MARKET_AGENT':
            try:
                qs = LossPrediction.objects.filter(order__market_agent=user.market_agent_profile)
            except Exception:
                return LossPrediction.objects.none()
        elif user.role in ('ADMIN', 'MINAGRI_OFFICER'):
            qs = LossPrediction.objects.all()
        else:
            return LossPrediction.objects.none()
        risk = self.request.query_params.get('risk')
        stage = self.request.query_params.get('stage')
        batch = self.request.query_params.get('batch')
        if risk:
            qs = qs.filter(risk_label=risk.upper())
        if stage:
            qs = qs.filter(prediction_stage=stage.upper())
        if batch:
            qs = qs.filter(batch_id=batch)
        return qs

    @action(detail=False, methods=['get'])
    def high_risk(self, request):
        qs = self.get_queryset().filter(risk_label=LossPrediction.RiskLabel.RED)
        return Response(LossPredictionSerializer(qs[:20], many=True).data)
