import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_controller.dart';
import '../storage/secure_storage.dart';

/// User-selectable Light/Dark/System theme, persisted locally so it survives
/// an app restart. Starts at [ThemeMode.system] (the honest default before
/// the persisted value has loaded) and updates once the stored preference
/// (if any) is read back — never forces the app into one fixed theme.
class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController(this._secureStorage) : super(ThemeMode.system) {
    _restore();
  }

  final SecureStorage _secureStorage;

  Future<void> _restore() async {
    final stored = await _secureStorage.read(StorageKeys.themeMode);
    final restored = _fromStorageValue(stored);
    if (restored != null) state = restored;
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    await _secureStorage.write(StorageKeys.themeMode, _toStorageValue(mode));
  }

  static ThemeMode? _fromStorageValue(String? value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      case 'system':
        return ThemeMode.system;
      default:
        return null;
    }
  }

  static String _toStorageValue(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }
}

final themeModeControllerProvider = StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController(ref.watch(secureStorageProvider));
});
