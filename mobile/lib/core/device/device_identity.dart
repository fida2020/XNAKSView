import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart' show kIsWeb;

import '../storage/secure_storage.dart';

/// The backend's DevicePlatform enum values.
enum DevicePlatform { ios, android, web, desktop }

extension DevicePlatformApiValue on DevicePlatform {
  String get apiValue => switch (this) {
        DevicePlatform.ios => 'IOS',
        DevicePlatform.android => 'ANDROID',
        DevicePlatform.web => 'WEB',
        DevicePlatform.desktop => 'DESKTOP',
      };
}

DevicePlatform currentDevicePlatform() {
  if (kIsWeb) return DevicePlatform.web;
  if (Platform.isIOS) return DevicePlatform.ios;
  if (Platform.isAndroid) return DevicePlatform.android;
  return DevicePlatform.desktop;
}

/// A stable, opaque, non-invasive per-install identifier: a random token
/// generated once and kept in secure storage. Deliberately NOT a hardware
/// identifier (IMEI, serial number, advertising ID, etc.) — the backend only
/// needs something stable enough to recognize "this install" across logins,
/// not something that identifies the physical device or the person.
class DeviceIdentity {
  const DeviceIdentity(this._secureStorage);

  final SecureStorage _secureStorage;

  Future<String> getOrCreate() async {
    final existing = await _secureStorage.read(StorageKeys.deviceId);
    if (existing != null && existing.isNotEmpty) return existing;

    final generated = _generateId();
    await _secureStorage.write(StorageKeys.deviceId, generated);
    return generated;
  }

  static String _generateId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  }
}
