import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/storage/secure_storage.dart';
import '../domain/auth_state.dart';

/// Holds app-wide authentication status. Actual sign-in/sign-up/token-refresh
/// logic belongs to Phase 2 — this controller only resolves the initial
/// state (by checking for a persisted access token) so routing can decide
/// between the auth flow and the authenticated app shell.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._secureStorage) : super(const AuthState()) {
    _restoreSession();
  }

  final SecureStorage _secureStorage;

  Future<void> _restoreSession() async {
    final token = await _secureStorage.read(StorageKeys.accessToken);
    state = AuthState(
      status: token == null ? AuthStatus.unauthenticated : AuthStatus.authenticated,
    );
  }

  Future<void> signOut() async {
    await _secureStorage.deleteAll();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final secureStorageProvider = Provider<SecureStorage>((ref) {
  return FlutterSecureStorageImpl();
});

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref.watch(secureStorageProvider));
});
