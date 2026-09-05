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

  Future<AuthSessionResult> register({
    String? email,
    String? phone,
    required String password,
    required DateTime dateOfBirth,
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
        'device': _deviceJson(deviceId, platform),
      },
    );
    return AuthSessionResult.fromJson(response.data!);
  }

  Future<AuthSessionResult> login({
    String? email,
    String? phone,
    required String password,
    required String deviceId,
    required DevicePlatform platform,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/auth/login',
      data: {
        'email': ?email,
        'phone': ?phone,
        'password': password,
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
