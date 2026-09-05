/// Compile-time environment configuration.
///
/// Values are injected via `--dart-define` at build time so no secrets or
/// per-environment values are hardcoded into source. Example:
///
/// flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
enum AppFlavor { development, staging, production }

class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000/api/v1',
  );

  static const String flavorName = String.fromEnvironment(
    'APP_FLAVOR',
    defaultValue: 'development',
  );

  static AppFlavor get flavor {
    switch (flavorName) {
      case 'production':
        return AppFlavor.production;
      case 'staging':
        return AppFlavor.staging;
      default:
        return AppFlavor.development;
    }
  }

  static const String appName = 'XNAKView';

  static const Duration apiConnectTimeout = Duration(seconds: 15);
  static const Duration apiReceiveTimeout = Duration(seconds: 15);

  /// Media (video/thumbnail) URLs from the backend are returned as paths
  /// relative to the API origin (e.g. `/api/v1/videos/x/file`), not full
  /// URLs — this resolves one against the configured origin.
  static Uri resolveMediaUrl(String path) {
    final base = Uri.parse(apiBaseUrl);
    return Uri(scheme: base.scheme, host: base.host, port: base.port).resolve(path);
  }
}
