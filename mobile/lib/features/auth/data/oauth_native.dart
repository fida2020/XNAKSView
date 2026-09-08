import 'package:flutter_facebook_auth/flutter_facebook_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../../core/config/app_config.dart';

/// Thin wrapper over the real native Google/Facebook SDKs — returns the
/// real provider token (Google's ID token, Facebook's access token) for the
/// backend to verify server-side (lib/oauthProviders.ts), or `null` if the
/// user cancelled. Never fabricates a token; a misconfigured native SDK
/// (missing/placeholder Facebook App ID, unregistered Google SHA-1) surfaces
/// as a real exception from the SDK itself rather than a fake success.
abstract class OAuthNative {
  /// Returns the Google ID token (audienced to [AppConfig.googleServerClientId]
  /// so the backend can verify it), or `null` if the user cancelled.
  Future<String?> signInWithGoogle();

  /// Returns the Facebook access token, or `null` if the user cancelled.
  Future<String?> signInWithFacebook();
}

class RealOAuthNative implements OAuthNative {
  GoogleSignIn? _googleSignIn;

  GoogleSignIn _getGoogleSignIn() {
    return _googleSignIn ??= GoogleSignIn(
      scopes: const ['email'],
      // Requests an ID token audienced to OUR backend's OAuth client
      // (GOOGLE_OAUTH_SERVER_CLIENT_ID) rather than the Android client —
      // that's what makes the token verifiable server-side.
      serverClientId: AppConfig.googleServerClientId,
    );
  }

  @override
  Future<String?> signInWithGoogle() async {
    final account = await _getGoogleSignIn().signIn();
    if (account == null) return null;
    final authentication = await account.authentication;
    return authentication.idToken;
  }

  @override
  Future<String?> signInWithFacebook() async {
    final result = await FacebookAuth.instance.login(permissions: const ['email', 'public_profile']);
    if (result.status != LoginStatus.success || result.accessToken == null) {
      if (result.status == LoginStatus.cancelled) return null;
      throw Exception(result.message ?? 'Facebook sign-in failed');
    }
    return result.accessToken!.tokenString;
  }
}
