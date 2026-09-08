import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/device/device_identity.dart';
import '../../../core/network/api_client_provider.dart';
import '../../../core/storage/secure_storage.dart';
import '../data/auth_repository.dart';
import '../data/oauth_native.dart';
import '../data/token_refresher.dart';
import '../domain/auth_state.dart';
import '../domain/user_account.dart';

/// Owns app-wide authentication status and the register/login/logout flows.
/// Screens call these methods and let thrown [AppException]s propagate for
/// the caller to turn into UI error state — this controller only tracks
/// "are we authenticated and does the user have a profile yet".
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._secureStorage, this._authRepository, this._deviceIdentity, this._tokenRefresher, this._oauthNative)
      : super(const AuthState()) {
    _restoreSession();
  }

  final SecureStorage _secureStorage;
  final AuthRepository _authRepository;
  final DeviceIdentity _deviceIdentity;
  final TokenRefresher _tokenRefresher;
  final OAuthNative _oauthNative;

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

  /// Sends a real, server-generated OTP — never a fake/local code. Screens
  /// call this directly (no need to route every OTP send through
  /// [AuthController] the way session-affecting calls are) since sending a
  /// code doesn't change auth state.
  Future<OtpRequestResult> requestOtp({String? email, String? phone, required String purpose}) {
    return _authRepository.requestOtp(email: email, phone: phone, purpose: purpose);
  }

  /// Verifies a REGISTER OTP, returning the `verificationToken` the
  /// birthday/credentials steps carry forward to [register].
  Future<String> verifyRegistrationOtp({String? email, String? phone, required String code}) {
    return _authRepository.verifyRegistrationOtp(email: email, phone: phone, code: code);
  }

  Future<void> register({
    String? email,
    String? phone,
    required String password,
    required DateTime dateOfBirth,
    required String verificationToken,
  }) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();

    final session = await _authRepository.register(
      email: email,
      phone: phone,
      password: password,
      dateOfBirth: dateOfBirth,
      verificationToken: verificationToken,
      deviceId: deviceId,
      platform: platform,
    );

    await _persistSession(session);
    state = AuthState(status: AuthStatus.authenticated, userId: session.user.id, hasProfile: false);
  }

  /// The passwordless "log in with code" alternative (brief §6) — OTP
  /// verification alone completes the login, same as password login.
  Future<void> loginWithOtp({String? email, String? phone, required String code}) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();

    final session = await _authRepository.verifyLoginOtp(
      email: email,
      phone: phone,
      code: code,
      deviceId: deviceId,
      platform: platform,
    );

    await _persistSession(session);
    await _resolveSessionFromBackend();
  }

  Future<void> login({String? email, String? phone, String? username, required String password}) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();

    final session = await _authRepository.login(
      email: email,
      phone: phone,
      username: username,
      password: password,
      deviceId: deviceId,
      platform: platform,
    );

    await _persistSession(session);
    await _resolveSessionFromBackend();
  }

  /// Drives the real native Google Sign-In SDK, then authenticates the
  /// resulting ID token with the backend. Returns `null` if the user
  /// cancelled the native sign-in sheet. A [OAuthLoginResult] updates auth
  /// state immediately (session persisted here); the other two outcomes are
  /// handed back to the caller screen to navigate to linking/signup-completion.
  Future<OAuthAuthResult?> continueWithGoogle() => _continueWithOAuth('GOOGLE', _oauthNative.signInWithGoogle);

  /// Same as [continueWithGoogle] but via the real native Facebook Login SDK.
  Future<OAuthAuthResult?> continueWithFacebook() => _continueWithOAuth('FACEBOOK', _oauthNative.signInWithFacebook);

  Future<OAuthAuthResult?> _continueWithOAuth(String provider, Future<String?> Function() getToken) async {
    final token = await getToken();
    if (token == null) return null; // user cancelled the native sheet

    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();
    final result = await _authRepository.authenticateOAuth(provider: provider, token: token, deviceId: deviceId, platform: platform);

    if (result is OAuthLoginResult) {
      await _persistSession(result.session);
      await _resolveSessionFromBackend();
    }
    return result;
  }

  /// Completes account linking (brief §5) — the existing account's password
  /// re-authenticates before the provider identity is attached.
  Future<void> linkOAuthAccount({required String linkingToken, required String password}) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();
    final session = await _authRepository.linkOAuthAccount(linkingToken: linkingToken, password: password, deviceId: deviceId, platform: platform);
    await _persistSession(session);
    await _resolveSessionFromBackend();
  }

  /// Completes a NEW social signup — the backend creates the account AND
  /// the Profile (username/displayName/avatar) together, so this directly
  /// reaches `hasProfile: true`, unlike phone/email registration's separate
  /// Profile Setup step.
  Future<void> completeOAuthSignup({required String socialSignupToken, required DateTime dateOfBirth, required String username, String? displayName}) async {
    final deviceId = await _deviceIdentity.getOrCreate();
    final platform = currentDevicePlatform();
    final session = await _authRepository.completeOAuthSignup(
      socialSignupToken: socialSignupToken,
      dateOfBirth: dateOfBirth,
      username: username,
      displayName: displayName,
      deviceId: deviceId,
      platform: platform,
    );
    await _persistSession(session);
    state = AuthState(status: AuthStatus.authenticated, userId: session.user.id, hasProfile: true);
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

final oauthNativeProvider = Provider<OAuthNative>((ref) {
  return RealOAuthNative();
});

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(
    ref.watch(secureStorageProvider),
    ref.watch(authRepositoryProvider),
    ref.watch(deviceIdentityProvider),
    ref.watch(tokenRefresherProvider),
    ref.watch(oauthNativeProvider),
  );
});
