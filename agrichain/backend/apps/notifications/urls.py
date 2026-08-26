from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'announcements', views.AnnouncementViewSet, basename='announcements')
router.register(r'', views.NotificationViewSet, basename='notifications')

urlpatterns = [
    # SSE must come before the router so the router doesn't swallow it as a detail URL
    path('stream/', views.notification_stream, name='notification-stream'),
    path('', include(router.urls)),
]
