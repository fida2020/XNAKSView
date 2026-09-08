import '../../../core/device/device_identity.dart';
import '../../../core/network/api_client.dart';
import '../domain/user_account.dart';

Map<String, dynamic> _deviceJson(String deviceId, DevicePlatform platform) => {
      'deviceIdentifier': deviceId,
      'platform': platform.apiValue,
    };

class AuthRepository {
  const AuthRepository(this._apiClient);

  final ApiClient _apiClient;

  /// Sends a real, server-generated OTP (SMS or email, per whichever of
  /// `email`/`phone` is given) — never a fake/local code. `purpose` is
  /// `'REGISTER'` or `'LOGIN'`.
  Future<OtpRequestResult> requestOtp({String? email, String? phone, required String purpose}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/otp/request',
      data: {'email': ?email, 'phone': ?phone, 'purpose': purpose},
    );
    return OtpRequestResult.fromJson(response.data!);
  }

  /// Verifies a REGISTER-purpose OTP and returns the short-lived
  /// `verificationToken` that `register` below requires — this is what
  /// actually gates account creation, not merely knowing the identifier.
  Future<String> verifyRegistrationOtp({String? email, String? phone, required String code}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/otp/verify',
      data: {'email': ?email, 'phone': ?phone, 'purpose': 'REGISTER', 'code': code},
    );
    return response.data!['verificationToken'] as String;
  }

  /// Verifies a LOGIN-purpose OTP — the passwordless "log in with code"
  /// alternative, completing login immediately on success (same
  /// lockout/status/session machinery as password login).
  Future<AuthSessionResult> verifyLoginOtp({
    String? email,
    String? phone,
    required String code,
    required String deviceId,
    required DevicePlatform platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/otp/verify',
      data: {'email': ?email, 'phone': ?phone, 'purpose': 'LOGIN', 'code': code, 'device': _deviceJson(deviceId, platform)},
    );
    return AuthSessionResult.fromJson(response.data!);
  }

  Future<AuthSessionResult> register({
    String? email,
    String? phone,
    required String password,
    required DateTime dateOfBirth,
    required String verificationToken,
    required String deviceId,
    required DevicePlatform platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/register',
      data: {
        'email': ?email,
        'phone': ?phone,
        'password': password,
        'dateOfBirth': dateOfBirth.toIso8601String().split('T').first,
        'verificationToken': verificationToken,
        'device': _deviceJson(deviceId, platform),
      },
    );
    return AuthSessionResult.fromJson(response.data!);
  }

  Future<AuthSessionResult> login({
    String? email,
    String? phone,
    String? username,
    required String password,
    required String deviceId,
    required DevicePlatform platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/login',
      data: {
        'email': ?email,
        'phone': ?phone,
        'username': ?username,
        'password': password,
        'device': _deviceJson(deviceId, platform),
      },
    );
    return AuthSessionResult.fromJson(response.data!);
  }

  /// `provider` is `'GOOGLE'` or `'FACEBOOK'`; `token` is the real
  /// provider-issued ID/access token from `oauth_native.dart` — verified
  /// server-side, never trusted here.
  Future<OAuthAuthResult> authenticateOAuth({
    required String provider,
    required String token,
    String? deviceId,
    DevicePlatform? platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/oauth/authenticate',
      data: {
        'provider': provider,
        'token': token,
        if (deviceId != null && platform != null) 'device': _deviceJson(deviceId, platform),
      },
    );
    final json = response.data!;
    if (json['needsLinking'] == true) {
      return OAuthNeedsLinkingResult(linkingToken: json['linkingToken'] as String, maskedEmail: json['maskedEmail'] as String);
    }
    if (json['isNewSignup'] == true) {
      return OAuthNewSignupResult(
        socialSignupToken: json['socialSignupToken'] as String,
        email: json['email'] as String?,
        suggestedUsername: json['suggestedUsername'] as String?,
        name: json['name'] as String?,
        pictureUrl: json['pictureUrl'] as String?,
      );
    }
    return OAuthLoginResult(session: AuthSessionResult.fromJson(json));
  }

  Future<AuthSessionResult> linkOAuthAccount({
    required String linkingToken,
    required String password,
    required String deviceId,
    required DevicePlatform platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/oauth/link',
      data: {'linkingToken': linkingToken, 'password': password, 'device': _deviceJson(deviceId, platform)},
    );
    return AuthSessionResult.fromJson(response.data!);
  }

  Future<AuthSessionResult> completeOAuthSignup({
    required String socialSignupToken,
    required DateTime dateOfBirth,
    required String username,
    String? displayName,
    required String deviceId,
    required DevicePlatform platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/oauth/complete-signup',
      data: {
        'socialSignupToken': socialSignupToken,
        'dateOfBirth': dateOfBirth.toIso8601String().split('T').first,
        'username': username,
        if (displayName != null && displayName.isNotEmpty) 'displayName': displayName,
        'device': _deviceJson(deviceId, platform),
      },
    );
    return AuthSessionResult.fromJson(response.data!);
  }

  Future<void> logout() async {
    await _apiClient.post<void>('/auth/logout');
  }

  Future<MeResult> fetchMe() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/me');
    return MeResult.fromJson(response.data!);
  }

  Future<ProfileModel> upsertProfile({
    required String username,
    String? displayName,
    String? bio,
    String? avatarUrl,
    String? country,
    String? city,
  }) async {
    final response = await _apiClient.put<Map<String, dynamic>>(
      '/profile',
      data: {
        'username': username,
        if (displayName != null && displayName.isNotEmpty) 'displayName': displayName,
        if (bio != null && bio.isNotEmpty) 'bio': bio,
        if (avatarUrl != null && avatarUrl.isNotEmpty) 'avatarUrl': avatarUrl,
        if (country != null && country.isNotEmpty) 'country': country,
        if (city != null && city.isNotEmpty) 'city': city,
      },
    );
    return ProfileModel.fromJson(response.data!);
  }
}
