import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../domain/user_account.dart';
import 'auth_controller.dart';

/// Shared "Continue with Google" / "Continue with Facebook" buttons and
/// their outcome-handling — used by both the sign-up landing screen and the
/// sign-in screen (brief §1/§4/§6), so the three real outcomes
/// (direct login / needs-linking / new-signup) are handled identically
/// everywhere a social button appears.
class OAuthButtons extends ConsumerStatefulWidget {
  const OAuthButtons({super.key});

  @override
  ConsumerState<OAuthButtons> createState() => _OAuthButtonsState();
}

class _OAuthButtonsState extends ConsumerState<OAuthButtons> {
  bool _isSubmitting = false;
  String? _errorMessage;

  Future<void> _continue(Future<OAuthAuthResult?> Function() action) async {
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    try {
      final result = await action();
      if (!mounted || result == null) return; // user cancelled the native sheet

      switch (result) {
        case OAuthLoginResult():
          break; // AuthController already persisted the session; router redirect takes over.
        case OAuthNeedsLinkingResult():
          context.pushOAuthLink(linkingToken: result.linkingToken, maskedEmail: result.maskedEmail);
        case OAuthNewSignupResult():
          context.pushOAuthCompleteSignup(
            socialSignupToken: result.socialSignupToken,
            email: result.email,
            suggestedUsername: result.suggestedUsername,
            name: result.name,
            pictureUrl: result.pictureUrl,
          );
      }
    } on AppException catch (error) {
      setState(() => _errorMessage = error.message);
    } catch (error) {
      // The native SDK itself throws when misconfigured (placeholder
      // Facebook App ID, unregistered Google SHA-1) — surfaced honestly,
      // never swallowed into a fake success.
      setState(() => _errorMessage = 'Sign-in failed: $error');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_errorMessage != null) ...[
          Text(_errorMessage!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
          const SizedBox(height: 12),
        ],
        SizedBox(
          height: 48,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Colors.black26),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            ),
            icon: const Text('G', style: TextStyle(fontWeight: FontWeight.w900, color: Color(0xFF4285F4), fontSize: 18)),
            label: const Text('Continue with Google', style: TextStyle(color: Colors.black87, fontWeight: FontWeight.w600)),
            onPressed: _isSubmitting ? null : () => _continue(() => ref.read(authControllerProvider.notifier).continueWithGoogle()),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Colors.black26),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            ),
            icon: const Icon(Icons.facebook, color: Color(0xFF1877F2)),
            label: const Text('Continue with Facebook', style: TextStyle(color: Colors.black87, fontWeight: FontWeight.w600)),
            onPressed: _isSubmitting ? null : () => _continue(() => ref.read(authControllerProvider.notifier).continueWithFacebook()),
          ),
        ),
        if (_isSubmitting) ...[
          const SizedBox(height: 12),
          const Center(child: CircularProgressIndicator()),
        ],
      ],
    );
  }
}

/// The "──── or ────" divider TikTok uses between the primary CTA and the
/// social buttons.
class OrDivider extends StatelessWidget {
  const OrDivider({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 16),
      child: Row(
        children: [
          Expanded(child: Divider()),
          Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: Colors.black45))),
          Expanded(child: Divider()),
        ],
      ),
    );
  }
}
