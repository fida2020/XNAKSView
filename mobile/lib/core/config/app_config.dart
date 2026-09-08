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

  /// The "Web application" Google OAuth Client ID (from Google Cloud
  /// Console) that the backend verifies Google ID tokens against
  /// (GOOGLE_OAUTH_SERVER_CLIENT_ID) — passed to `google_sign_in` as
  /// `serverClientId` so Google issues a token audienced to this id rather
  /// than the Android client id. Empty until configured; `google_sign_in`
  /// then simply won't produce a server-verifiable ID token, and Google
  /// sign-in fails honestly rather than silently.
  static const String googleServerClientId = String.fromEnvironment('GOOGLE_OAUTH_SERVER_CLIENT_ID');

  /// Real Face AR (Banuba SDK) client license token — never hard-coded in
  /// source, read from a build-time define (see mobile's build commands /
  /// android/banuba.properties.example for where the real value lives
  /// locally). Empty until configured; `BanubaCameraController.initialize`
  /// then honestly reports "not configured" rather than silently no-op'ing.
  static const String banubaClientToken = String.fromEnvironment('BANUBA_CLIENT_TOKEN');

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
