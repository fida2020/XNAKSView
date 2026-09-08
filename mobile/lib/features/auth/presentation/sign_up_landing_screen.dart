import 'package:flutter/material.dart';

import '../../../core/config/app_config.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/xnak_colors.dart';
import 'oauth_buttons.dart';

/// Sign up (brief §1) — TikTok's real landing screen shows a list of
/// sign-up methods. "Use phone or email" leads to the OTP-first flow;
/// "Continue with Google/Facebook" drive the REAL native SDKs
/// (oauth_native.dart), verified server-side — never a fake button that
/// goes nowhere.
class SignUpLandingScreen extends StatelessWidget {
  const SignUpLandingScreen({super.key});

  void _showHelp(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Need help?'),
        content: const Text('If you\'re having trouble creating your account, make sure you can receive SMS or email on the phone number or address you\'re signing up with.'),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        foregroundColor: Colors.black,
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.of(context).maybePop()),
        title: const Text('Sign up', style: TextStyle(color: Colors.black, fontWeight: FontWeight.w600)),
        centerTitle: true,
        actions: [
          IconButton(icon: const Icon(Icons.help_outline), color: Colors.black87, onPressed: () => _showHelp(context)),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              const Spacer(),
              Image.asset('assets/branding/xnakview_logo.png', width: 96, height: 96),
              const SizedBox(height: 16),
              ShaderMask(
                shaderCallback: (bounds) => XnakColors.brandGradient.createShader(bounds),
                child: Text(
                  AppConfig.appName,
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Colors.white),
                ),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Colors.black26),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                  ),
                  icon: const Icon(Icons.phone_iphone, color: Colors.black87),
                  label: const Text('Use phone or email', style: TextStyle(color: Colors.black87, fontWeight: FontWeight.w600)),
                  onPressed: () => context.pushSignUpIdentifier(),
                ),
              ),
              const OrDivider(),
              const OAuthButtons(),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Already have an account?', style: TextStyle(color: Colors.black54)),
                  TextButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('Log in', style: TextStyle(color: XnakColors.magenta, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}
