import 'package:dio/dio.dart';

import '../../../core/config/app_config.dart';
import '../../../core/storage/secure_storage.dart';

/// Performs the refresh-token exchange directly (bypassing [ApiClient]'s auth
/// interceptor, since the request that would need refreshing is the one
/// asking for a fresh token in the first place).
class TokenRefresher {
  TokenRefresher(this._secureStorage, [Dio? dio])
      : _dio = dio ?? Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl, headers: {'Content-Type': 'application/json'}));

  final SecureStorage _secureStorage;
  final Dio _dio;

  /// Attempts to exchange the stored refresh token for a new session,
  /// persisting the rotated pair on success. Returns whether it succeeded.
  Future<bool> tryRefresh() async {
    final refreshToken = await _secureStorage.read(StorageKeys.refreshToken);
    if (refreshToken == null) return false;

    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = response.data!;
      await _secureStorage.write(StorageKeys.accessToken, data['accessToken'] as String);
      await _secureStorage.write(StorageKeys.refreshToken, data['refreshToken'] as String);
      return true;
    } on DioException {
      return false;
    }
  }
}
