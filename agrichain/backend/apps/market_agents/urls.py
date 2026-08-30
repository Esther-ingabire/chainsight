from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'agents', views.MarketAgentViewSet, basename='market-agents')
router.register(r'collections', views.CollectionConfirmationViewSet, basename='collections')
router.register(r'waste-reports', views.WasteReportViewSet, basename='waste-reports')
router.register(r'price-records', views.MarketPriceRecordViewSet, basename='price-records')

urlpatterns = [
    path('', include(router.urls)),
    path('notices/', views.AvailableNoticesView.as_view(), name='agent-notices'),
]
