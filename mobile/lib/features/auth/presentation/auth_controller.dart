import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/device/device_identity.dart';
import '../../../core/network/api_client_provider.dart';
import '../../../core/storage/secure_storage.dart';
import '../data/auth_repository.dart';
import '../data/token_refresher.dart';
import '../domain/auth_state.dart';
import '../domain/user_account.dart';

/// Owns app-wide authentication status and the register/login/logout flows.
/// Screens call these methods and let thrown [AppException]s propagate for
/// the caller to turn into UI error state — this controller only tracks
/// "are we authenticated and does the user have a profile yet".
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._secureStorage, this._authRepository, this._deviceIdentity, this._tokenRefresher)
      : super(const AuthState()) {
    _restoreSession();
  }

  final SecureStorage _secureStorage;
  final AuthRepository _authRepository;
  final DeviceIdentity _deviceIdentity;
  final TokenRefresher _tokenRefresher;

  Future<void> _restoreSession() async {
    final token = await _secureStorage.read(StorageKeys.accessToken);
    if (token == null) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }

    if (await _resolveSessionFromBackend()) return;

    // The access token is stale (expired/revoked) — try the refresh token
    // once before giving up and treating this as a logged-out install.
    if (await _tokenRefresher.tryRefresh() && await _resolveSessionFromBackend()) {
      return;
    }

    await _secureStorage.delete(StorageKeys.accessToken);
    await _secureStorage.delete(StorageKeys.refreshToken);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Fetches `/me` and updates state on success. Returns whether it succeeded.
  Future<bool> _resolveSessionFromBackend() async {
    try {
      final me = await _authRepository.fetchMe();
      state = AuthState(status: AuthStatus.authenticated, userId: me.user.id, hasProfile: me.profile != null);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> register({
    String? email,
    String? phone,
    required String password,
    required DateTime dateOfBirth,
  }) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();

    final session = await _authRepository.register(
      email: email,
      phone: phone,
      password: password,
      dateOfBirth: dateOfBirth,
      deviceId: deviceId,
      platform: platform,
    );

    await _persistSession(session);
    state = AuthState(status: AuthStatus.authenticated, userId: session.user.id, hasProfile: false);
  }

  Future<void> login({String? email, String? phone, required String password}) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();

    final session = await _authRepository.login(
      email: email,
      phone: phone,
      password: password,
      deviceId: deviceId,
      platform: platform,
    );

    await _persistSession(session);
    await _resolveSessionFromBackend();
  }

  Future<void> completeProfileSetup() async {
    state = state.copyWith(hasProfile: true);
  }

  Future<void> signOut() async {
    try {
      await _authRepository.logout();
    } catch (_) {
      // Best-effort: even if the backend call fails (e.g. offline), the user
      // must still be able to sign out of this device.
    }
    await _secureStorage.delete(StorageKeys.accessToken);
    await _secureStorage.delete(StorageKeys.refreshToken);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  Future<void> _persistSession(AuthSessionResult session) async {
    await _secureStorage.write(StorageKeys.accessToken, session.accessToken);
    await _secureStorage.write(StorageKeys.refreshToken, session.refreshToken);
  }
}

final secureStorageProvider = Provider<SecureStorage>((ref) {
  return FlutterSecureStorageImpl();
});

final deviceIdentityProvider = Provider<DeviceIdentity>((ref) {
  return DeviceIdentity(ref.watch(secureStorageProvider));
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(apiClientProvider));
});

final tokenRefresherProvider = Provider<TokenRefresher>((ref) {
  return TokenRefresher(ref.watch(secureStorageProvider));
});

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(
    ref.watch(secureStorageProvider),
    ref.watch(authRepositoryProvider),
    ref.watch(deviceIdentityProvider),
    ref.watch(tokenRefresherProvider),
  );
});
