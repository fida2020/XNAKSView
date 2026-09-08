import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/xnak_colors.dart';
import 'auth_controller.dart';
import 'oauth_buttons.dart';

/// Log in (brief §6) — TikTok-style: a single identifier field that accepts
/// email, phone, OR username (auto-detected) plus the existing password
/// login, PLUS a real "Log in with code" alternative for phone/email
/// (username has no OTP channel — code login only applies to phone/email).
/// Password login is never removed.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

enum _LoginMode { password, code }

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _passwordController = TextEditingController();

  _LoginMode _mode = _LoginMode.password;
  bool _obscurePassword = true;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// Auto-detects which field the typed identifier actually is — TikTok's
  /// real login screen doesn't make the user pick a tab for this.
  ({String? email, String? phone, String? username}) _classifyIdentifier(String raw) {
    final value = raw.trim();
    if (value.contains('@')) return (email: value.toLowerCase(), phone: null, username: null);
    if (RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(value)) return (email: null, phone: value, username: null);
    return (email: null, phone: null, username: value.toLowerCase());
  }

  Future<void> _submitPassword() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final identifier = _classifyIdentifier(_identifierController.text);

    try {
      await ref.read(authControllerProvider.notifier).login(
            email: identifier.email,
            phone: identifier.phone,
            username: identifier.username,
            password: _passwordController.text,
          );
      // On success, GoRouter's redirect (driven by AuthController state) takes over.
    } on AppException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _requestLoginCode() async {
    final identifier = _classifyIdentifier(_identifierController.text);
    if (identifier.username != null) {
      setState(() => _errorMessage = 'Enter a phone number or email to log in with a code');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final result = await ref
          .read(authControllerProvider.notifier)
          .requestOtp(email: identifier.email, phone: identifier.phone, purpose: 'LOGIN');
      if (!mounted) return;
      context.pushOtpVerify(
        email: identifier.email,
        phone: identifier.phone,
        purpose: 'LOGIN',
        maskedIdentifier: result.maskedIdentifier,
        resendAvailableInSeconds: result.resendAvailableInSeconds,
      );
    } on AppException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Image.asset('assets/branding/xnakview_logo.png', width: 64, height: 64),
                    const SizedBox(height: 16),
                    Text(
                      'Log in to ${AppConfig.appName}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.black),
                    ),
                    const SizedBox(height: 24),
                    TextFormField(
                      controller: _identifierController,
                      decoration: const InputDecoration(labelText: 'Phone / email / username', border: OutlineInputBorder()),
                      validator: (value) => (value == null || value.trim().isEmpty) ? 'Required' : null,
                    ),
                    if (_mode == _LoginMode.password) ...[
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        decoration: InputDecoration(
                          labelText: 'Password',
                          border: const OutlineInputBorder(),
                          suffixIcon: IconButton(
                            icon: Icon(_obscurePassword ? Icons.visibility : Icons.visibility_off),
                            onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                          ),
                        ),
                        validator: (value) => (value == null || value.isEmpty) ? 'Required' : null,
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: _isSubmitting ? null : () => setState(() => _mode = _LoginMode.code),
                          child: const Text('Forgot password? Log in with a code'),
                        ),
                      ),
                    ],
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 8),
                      Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 52,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: XnakColors.magenta,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                        ),
                        onPressed: _isSubmitting ? null : (_mode == _LoginMode.password ? _submitPassword : _requestLoginCode),
                        child: _isSubmitting
                            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : Text(_mode == _LoginMode.password ? 'Log in' : 'Send code', style: const TextStyle(fontWeight: FontWeight.w700)),
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (_mode == _LoginMode.code)
                      Center(
                        child: TextButton(
                          onPressed: _isSubmitting ? null : () => setState(() => _mode = _LoginMode.password),
                          child: const Text('Use password instead'),
                        ),
                      ),
                    const OrDivider(),
                    const OAuthButtons(),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Text("Don't have an account?", style: TextStyle(color: Colors.black54)),
                        TextButton(
                          onPressed: _isSubmitting ? null : () => context.pushSignUp(),
                          child: const Text('Sign up', style: TextStyle(color: XnakColors.magenta, fontWeight: FontWeight.w700)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
