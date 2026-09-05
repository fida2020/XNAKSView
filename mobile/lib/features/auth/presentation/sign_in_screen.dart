import 'package:flutter/material.dart';

/// Placeholder sign-in screen. Real authentication UI/flows are built in
/// Phase 2 — this exists so routing has a concrete unauthenticated
/// destination to land on.
class SignInScreen extends StatelessWidget {
  const SignInScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Text(
          'Sign in (coming in Phase 2)',
          style: Theme.of(context).textTheme.titleMedium,
        ),
      ),
    );
  }
}
