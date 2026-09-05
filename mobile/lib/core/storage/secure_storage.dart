import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Abstraction over secure, encrypted local key-value storage.
///
/// Callers depend on this interface, not on `flutter_secure_storage`
/// directly, so the underlying implementation (or a fake for tests) can be
/// swapped without touching feature code.
abstract class SecureStorage {
  Future<void> write(String key, String value);
  Future<String?> read(String key);
  Future<void> delete(String key);
  Future<void> deleteAll();
}

class FlutterSecureStorageImpl implements SecureStorage {
  FlutterSecureStorageImpl([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);

  @override
  Future<void> deleteAll() => _storage.deleteAll();
}

/// Known storage keys. Centralized to avoid typo-based key collisions.
class StorageKeys {
  const StorageKeys._();

  static const String accessToken = 'auth.access_token';
  static const String refreshToken = 'auth.refresh_token';
}
