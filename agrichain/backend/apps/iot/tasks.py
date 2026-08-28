"""IoT simulation task — generates mock sensor readings for development/demo."""
from celery import shared_task
import random
from django.utils import timezone


@shared_task
def simulate_sensor_readings():
    """
    Generates realistic mock sensor data for all IoT-enabled facilities and active trips.
    Runs every 15 minutes in development. In production, real ESP32 devices POST data.
    """
    from apps.cooperatives.models import ColdStorageFacility
    from apps.iot.models import IoTReading, VehicleIoTReading
    from apps.transport.models import Trip

    now = timezone.now()

    # Cold storage facility readings — skip facilities that already have a real device
    # assigned (sensor_device_id set), so simulated data doesn't mix with real ESP8266 posts.
    for facility in ColdStorageFacility.objects.filter(
        has_iot_sensor=True, is_active=True, sensor_device_id=""
    ):
        base_temp = 8.0
        temp = base_temp + random.gauss(0, 2.0)
        humidity = 75.0 + random.gauss(0, 5.0)
        IoTReading.objects.create(
            facility=facility,
            temperature_celsius=round(temp, 1),
            humidity_percent=round(humidity, 1),
            timestamp=now,
        )

    # Active refrigerated vehicle readings — skip trips that are already picked up and in
    # transit, since those get real sensor data mirrored in from the ESP8266 storage device
    # (see IoTReadingViewSet.perform_create) and shouldn't also receive fake simulated readings.
    active_trips = Trip.objects.filter(
        pickup_confirmed_at__isnull=False,
        delivery_confirmed_at__isnull=True,
        transport_request__vehicle__has_iot_temperature=True
    ).select_related("transport_request__vehicle")

    for trip in active_trips:
        base_temp = 6.0
        temp = base_temp + random.gauss(0, 2.5)
        VehicleIoTReading.objects.create(
            trip=trip,
            temperature_celsius=round(temp, 1),
            timestamp=now,
        )

    return f"Simulated IoT readings at {now.strftime('%H:%M')}"
