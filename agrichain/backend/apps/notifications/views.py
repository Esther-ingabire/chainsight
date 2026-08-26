import json
import time
from django.http import StreamingHttpResponse, HttpResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken
from .models import Notification, Announcement
from .serializers import NotificationSerializer, AnnouncementSerializer
from apps.authentication.permissions import IsAdminRole


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Notification.objects.filter(recipient=self.request.user)
        unread_only = self.request.query_params.get('unread')
        if unread_only == 'true':
            qs = qs.filter(is_read=False)
        return qs

    @action(detail=True, methods=['post'])
    def read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save()
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        updated = Notification.objects.filter(
            recipient=request.user, is_read=False
        ).update(is_read=True, read_at=timezone.now())
        return Response({'marked_read': updated})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return Response({'count': count})


class AnnouncementViewSet(viewsets.ModelViewSet):
    """
    Admin CRUD for system-wide announcements. Posting a new one, or reactivating an
    inactive one, fans out a SYSTEM_ANNOUNCEMENT Notification to every active user
    (delivered live via the existing bell/SSE stream) — not on every edit, so
    correcting a typo on an already-active announcement doesn't re-notify everyone.
    """
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminRole]
    queryset = Announcement.objects.all()

    def perform_create(self, serializer):
        announcement = serializer.save(created_by=self.request.user)
        self._fan_out(announcement)

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        announcement = serializer.save()
        if announcement.is_active and not was_active:
            self._fan_out(announcement)

    def _fan_out(self, announcement):
        from apps.authentication.models import User
        from .services import notify
        for user in User.objects.filter(is_active=True):
            notify(
                user, Notification.NotificationType.SYSTEM_ANNOUNCEMENT,
                announcement.title, announcement.body,
                related_object_type='announcement', related_object_id=announcement.id,
            )


def notification_stream(request):
    """
    SSE endpoint — streams new notifications to the connected user in real time.
    Auth via ?token=<jwt> because EventSource doesn't support custom headers.
    Polls the DB every 15 s and sends a heartbeat comment to keep the connection alive.
    """
    raw_token = request.GET.get('token', '').strip()
    if not raw_token:
        return HttpResponse(status=401)

    try:
        jwt_auth = JWTAuthentication()
        validated_token = jwt_auth.get_validated_token(raw_token)
        user = jwt_auth.get_user(validated_token)
    except (TokenError, InvalidToken, Exception):
        return HttpResponse(status=401)

    def event_generator(user):
        # Only stream notifications created after the connection opens —
        # the initial list is loaded separately via REST.
        last_id = (
            Notification.objects.filter(recipient=user)
            .order_by('-id')
            .values_list('id', flat=True)
            .first()
        ) or 0

        while True:
            try:
                new_notifs = list(
                    Notification.objects
                    .filter(recipient=user, id__gt=last_id)
                    .order_by('id')
                )
                for n in new_notifs:
                    payload = json.dumps({
                        'id': n.id,
                        'title': n.title,
                        'message': n.message,
                        'notification_type': n.notification_type,
                        'is_read': n.is_read,
                        'created_at': n.created_at.isoformat(),
                    })
                    yield f'data: {payload}\n\n'
                    last_id = n.id

                # Heartbeat — browsers drop idle SSE connections after ~30 s without data
                yield ': heartbeat\n\n'
                time.sleep(15)

            except GeneratorExit:
                break

    response = StreamingHttpResponse(
        event_generator(user),
        content_type='text/event-stream; charset=utf-8',
    )
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'  # Nginx: disable response buffering for SSE
    return response
