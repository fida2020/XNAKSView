import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import 'auth_controller.dart';

/// Final signup step (brief §5) — OTP already proved ownership of the
/// phone/email and the birthday is already collected; this step
/// establishes the password our authentication architecture requires and
/// gets Terms/Privacy consent before actually creating the account.
/// Username/display name/avatar remain the existing post-registration
/// Profile Setup step (unchanged) — not duplicated here.
class SignUpCredentialsScreen extends ConsumerStatefulWidget {
  const SignUpCredentialsScreen({
    super.key,
    this.email,
    this.phone,
    required this.verificationToken,
    required this.dateOfBirth,
  });

  final String? email;
  final String? phone;
  final String verificationToken;
  final DateTime dateOfBirth;

  @override
  ConsumerState<SignUpCredentialsScreen> createState() => _SignUpCredentialsScreenState();
}

class _SignUpCredentialsScreenState extends ConsumerState<SignUpCredentialsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  bool _obscure = true;
  bool _agreedToTerms = false;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  String? _validatePassword(String? value) {
    if (value == null || value.length < 10) return 'At least 10 characters';
    if (!RegExp(r'[a-z]').hasMatch(value)) return 'Add a lowercase letter';
    if (!RegExp(r'[A-Z]').hasMatch(value)) return 'Add an uppercase letter';
    if (!RegExp(r'\d').hasMatch(value)) return 'Add a digit';
    if (!RegExp(r'[^A-Za-z0-9]').hasMatch(value)) return 'Add a symbol';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_passwordController.text != _confirmController.text) {
      setState(() => _errorMessage = 'Passwords do not match');
      return;
    }
    if (!_agreedToTerms) {
      setState(() => _errorMessage = 'You must agree to the Terms of Service and Privacy Policy');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).register(
            email: widget.email,
            phone: widget.phone,
            password: _passwordController.text,
            dateOfBirth: widget.dateOfBirth,
            verificationToken: widget.verificationToken,
          );
      // On success, GoRouter's redirect (driven by AuthController state)
      // takes over — to Profile Setup (username/display name/avatar).
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
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        foregroundColor: Colors.black,
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.of(context).maybePop()),
        title: const Text('Create a password', style: TextStyle(color: Colors.black, fontWeight: FontWeight.w600)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 8),
                const Text(
                  "You'll use this to log in, or to recover your account with a code.",
                  style: TextStyle(color: Colors.black54),
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _passwordController,
                  obscureText: _obscure,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    border: const OutlineInputBorder(),
                    helperText: 'At least 10 characters, with upper/lowercase, a digit, and a symbol',
                    helperMaxLines: 2,
                    suffixIcon: IconButton(
                      icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: _validatePassword,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _confirmController,
                  obscureText: _obscure,
                  decoration: const InputDecoration(labelText: 'Confirm password', border: OutlineInputBorder()),
                  validator: (value) => (value == null || value.isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: 16),
                CheckboxListTile(
                  value: _agreedToTerms,
                  onChanged: (value) => setState(() => _agreedToTerms = value ?? false),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text.rich(
                    TextSpan(
                      style: TextStyle(color: Colors.black87, fontSize: 13),
                      children: [
                        TextSpan(text: 'I agree to the '),
                        TextSpan(text: 'Terms of Service', style: TextStyle(color: XnakColors.magenta, fontWeight: FontWeight.w600)),
                        TextSpan(text: ' and '),
                        TextSpan(text: 'Privacy Policy', style: TextStyle(color: XnakColors.magenta, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                ),
                if (_errorMessage != null) ...[
                  const SizedBox(height: 8),
                  Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 20),
                SizedBox(
                  height: 52,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: XnakColors.magenta,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                    ),
                    onPressed: _isSubmitting ? null : _submit,
                    child: _isSubmitting
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Create account', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
