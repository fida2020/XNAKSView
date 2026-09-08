import 'package:xnakview/core/storage/secure_storage.dart';

/// In-memory [SecureStorage] fake — auth-flow widget tests need a real
/// (non-throwing) storage so [AuthController]'s constructor-time
/// `_restoreSession()` resolves cleanly to "unauthenticated" without ever
/// touching the platform's real secure storage plugin, which isn't
/// available in the widget-test environment.
class FakeSecureStorage implements SecureStorage {
  final Map<String, String> _values = {};

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> delete(String key) async => _values.remove(key);

  @override
  Future<void> deleteAll() async => _values.clear();
}
