import 'package:flutter/material.dart';

/// Startup screen shown while the app resolves initial auth state.
/// Purely presentational — [AuthController] drives the actual redirect.
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
            const SizedBox(height: 24),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
