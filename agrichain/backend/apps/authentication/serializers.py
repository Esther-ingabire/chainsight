"""
Authentication serializers: login, OTP, registration requests, user profile.
"""
from django.utils import timezone
from rest_framework import serializers
from .models import User, AccessRequest, DocumentUpload, OTPRecord, AuditLog
import hashlib, secrets


class LoginSerializer(serializers.Serializer):
    credential = serializers.CharField(help_text="Phone number or email")
    password   = serializers.CharField(write_only=True)

    def validate(self, data):
        credential = data["credential"].strip()
        user = None
        try:
            user = User.objects.get(phone_number=credential)
        except User.DoesNotExist:
            try:
                user = User.objects.get(email=credential)
            except User.DoesNotExist:
                pass
        if user is None:
            raise serializers.ValidationError({"credential": "No account found."})
        if user.is_locked():
            locked_time = user.locked_until.strftime("%H:%M")
            raise serializers.ValidationError({"credential": f"Account locked until {locked_time}"})
        if not user.check_password(data["password"]):
            user.record_failed_login()
            raise serializers.ValidationError({"password": "Incorrect password."})
        if not user.is_active:
            raise serializers.ValidationError({"credential": "Account suspended."})
        if not user.is_verified:
            raise serializers.ValidationError({"credential": "Account not activated. Check your email for OTP."})
        user.reset_failed_logins()
        data["user"] = user
        return data


class OTPVerifySerializer(serializers.Serializer):
    credential = serializers.CharField(help_text="Phone number or email")
    otp_code   = serializers.CharField(max_length=6, min_length=6)
    purpose    = serializers.ChoiceField(
        choices=OTPRecord.Purpose.choices,
        default=OTPRecord.Purpose.ACCOUNT_ACTIVATION,
        required=False,
    )

    def validate(self, data):
        credential = data["credential"].strip()
        user = None
        try:
            user = User.objects.get(phone_number=credential)
        except User.DoesNotExist:
            try:
                user = User.objects.get(email=credential)
            except User.DoesNotExist:
                pass
        if user is None:
            raise serializers.ValidationError({"credential": "No account with this phone number or email."})

        purpose = data.get("purpose") or OTPRecord.Purpose.ACCOUNT_ACTIVATION
        otp_hash = hashlib.sha256(data["otp_code"].encode()).hexdigest()
        try:
            otp_record = OTPRecord.objects.filter(user=user, purpose=purpose, is_used=False).latest("created_at")
        except OTPRecord.DoesNotExist:
            raise serializers.ValidationError({"otp_code": "No active OTP found. Contact your administrator."})
        if otp_record.otp_code != otp_hash:
            raise serializers.ValidationError({"otp_code": "Incorrect OTP code."})
        if otp_record.is_expired():
            raise serializers.ValidationError({"otp_code": "OTP has expired. Contact your administrator for a new one."})
        data["user"] = user
        data["otp_record"] = otp_record
        return data


class SetPasswordSerializer(serializers.Serializer):
    new_password     = serializers.CharField(min_length=8, write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, data):
        if data["new_password"] != data["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data


class AccessRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AccessRequest
        fields = ["id","full_name","role_requested","organization_name","district","phone_number","email","acknowledgement","status","created_at"]
        read_only_fields = ["id","status","created_at"]

    def validate(self, data):
        if not data.get("acknowledgement"):
            raise serializers.ValidationError({"acknowledgement": "You must acknowledge admin review."})
        if AccessRequest.objects.filter(phone_number=data["phone_number"], status=AccessRequest.Status.PENDING).exists():
            raise serializers.ValidationError({"phone_number": "A pending request already exists for this phone."})
        return data


class AccessRequestAdminSerializer(serializers.ModelSerializer):
    documents = serializers.SerializerMethodField()
    class Meta:
        model  = AccessRequest
        fields = "__all__"
        # status/reviewed_by/reviewed_at/created_user/admin_notes only ever change through
        # approve_and_create_user/reject_access_request (direct model writes) — a plain PATCH
        # shouldn't be able to mark a request APPROVED/REJECTED without actually creating the
        # user account, sending the activation OTP, or writing the audit log those do.
        read_only_fields = ["id", "status", "admin_notes", "reviewed_by", "reviewed_at",
                             "created_user", "created_at"]
    def get_documents(self, obj):
        request = self.context.get('request')
        docs = []
        for d in obj.documents.all():
            url = d.file.url if d.file else None
            if url and request:
                url = request.build_absolute_uri(url)
            docs.append({"id": d.id, "type": d.document_type, "url": url})
        return docs


class UserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = ["id","username","first_name","last_name","email","phone_number","role","organization_name","district","language_preference","is_active","is_verified","must_change_password","mfa_enabled","created_at","avatar_url"]
        # mfa_enabled only ever changes through mfa_enable (requires a verified OTP code) or
        # mfa_disable (requires the user's current password) — never client-settable directly,
        # or an admin's plain PATCH could flip a user's 2FA on/off without either check.
        read_only_fields = ["id","role","is_verified","must_change_password","mfa_enabled","created_at","avatar_url"]

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return None
        request = self.context.get('request')
        url = obj.avatar.url
        return request.build_absolute_uri(url) if request else url


class UserCreateSerializer(serializers.ModelSerializer):
    username = serializers.CharField(required=False)

    class Meta:
        model  = User
        fields = ["username","first_name","last_name","email","phone_number","role","organization_name","district","language_preference"]

    def create(self, validated_data):
        import re
        phone = validated_data.get("phone_number", "")
        digits = re.sub(r'\D', '', phone)[-8:] or secrets.token_hex(4)
        role_prefix = validated_data.get("role", "user").lower().replace("_", ".")[:8]
        base = validated_data.pop("username", None) or f"{role_prefix}.{digits}"
        username = base
        suffix = 1
        while User.objects.filter(username=username).exists():
            username = f"{base}.{suffix}"
            suffix += 1
        # email is unique=True but stored as '' (not NULL) if left blank — and unlike NULL,
        # Postgres enforces uniqueness on '', so a second blank-email registration would
        # fail with a false "email already exists". Normalize blank to None to avoid that.
        if not validated_data.get("email"):
            validated_data["email"] = None
        temp_password = secrets.token_urlsafe(16)
        user = User(username=username, **validated_data)
        user.set_password(temp_password)
        user.must_change_password = True
        user.is_verified = False
        user.is_active = True
        user.save()
        return user


class AuditLogSerializer(serializers.ModelSerializer):
    user_display = serializers.SerializerMethodField()
    class Meta:
        model  = AuditLog
        fields = ["id","user","user_display","action","description","ip_address","content_type","object_id","timestamp"]
    def get_user_display(self, obj):
        return f"{obj.user.get_full_name()} ({obj.user.phone_number})" if obj.user else "Anonymous"
