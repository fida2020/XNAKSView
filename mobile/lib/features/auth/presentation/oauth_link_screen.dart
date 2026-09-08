import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import 'auth_controller.dart';

/// Account linking (brief §5) — shown when a verified Google/Facebook email
/// already belongs to an existing XNAKView account that hasn't linked this
/// provider yet. Never silently links or takes over the account: the
/// existing password is required as re-authentication proof first.
class OAuthLinkScreen extends ConsumerStatefulWidget {
  const OAuthLinkScreen({super.key, required this.linkingToken, required this.maskedEmail});

  final String linkingToken;
  final String maskedEmail;

  @override
  ConsumerState<OAuthLinkScreen> createState() => _OAuthLinkScreenState();
}

class _OAuthLinkScreenState extends ConsumerState<OAuthLinkScreen> {
  final _passwordController = TextEditingController();
  bool _obscure = true;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_passwordController.text.isEmpty) {
      setState(() => _errorMessage = 'Enter your password');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).linkOAuthAccount(linkingToken: widget.linkingToken, password: _passwordController.text);
      // On success, GoRouter's redirect takes over.
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
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              const Text('This email is already registered', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.black)),
              const SizedBox(height: 8),
              Text('Enter the password for ${widget.maskedEmail} to link this sign-in method to your account.', style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 24),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: 'Password',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 20),
              SizedBox(
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: XnakColors.magenta, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26))),
                  onPressed: _isSubmitting ? null : _submit,
                  child: _isSubmitting
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Link account', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
