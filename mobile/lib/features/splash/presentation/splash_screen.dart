import 'package:flutter/material.dart';

import '../../../core/theme/xnak_colors.dart';

/// Startup screen shown while the app resolves initial auth state.
/// Purely presentational — [AuthController] drives the actual redirect.
///
/// The launcher-icon artwork (`assets/branding/xnakview_logo.png`) is the
/// icon-only "X" mark, deliberately with no wordmark baked in — text baked
/// into a launcher icon is illegible once scaled down to a home-screen icon
/// size. The "XNAKView" name is rendered here as a real `Text` widget
/// instead, in the app's own locked brand gradient.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset(
              'assets/branding/xnakview_logo.png',
              width: 160,
              height: 160,
              errorBuilder: (context, error, stackTrace) =>
                  Icon(Icons.play_circle_fill, size: 72, color: colorScheme.primary),
            ),
            const SizedBox(height: 16),
            ShaderMask(
              shaderCallback: (bounds) => XnakColors.brandGradient.createShader(bounds),
              child: const Text(
                'XNAKView',
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: 0.5),
              ),
            ),
            const SizedBox(height: 24),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
