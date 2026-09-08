import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import 'auth_controller.dart';

/// Profile setup after a NEW Google/Facebook signup (brief §2) — the
/// provider already proved ownership of the identity, so this is the ONE
/// remaining step before the account exists: confirm name/username, pick a
/// birthday (never assumed from the provider — brief §3), and agree to
/// Terms/Privacy. The provider's own profile photo is used as-is (server
/// defaults to it when no `avatarUrl` is sent) — editing it later happens
/// from the existing profile screen, not duplicated here.
class OAuthCompleteSignupScreen extends ConsumerStatefulWidget {
  const OAuthCompleteSignupScreen({
    super.key,
    required this.socialSignupToken,
    this.email,
    this.suggestedUsername,
    this.name,
    this.pictureUrl,
  });

  final String socialSignupToken;
  final String? email;
  final String? suggestedUsername;
  final String? name;
  final String? pictureUrl;

  @override
  ConsumerState<OAuthCompleteSignupScreen> createState() => _OAuthCompleteSignupScreenState();
}

class _OAuthCompleteSignupScreenState extends ConsumerState<OAuthCompleteSignupScreen> {
  late final _displayNameController = TextEditingController(text: widget.name ?? '');
  late final _usernameController = TextEditingController(text: widget.suggestedUsername ?? '');

  DateTime? _dateOfBirth;
  bool _agreedToTerms = false;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _displayNameController.dispose();
    _usernameController.dispose();
    super.dispose();
  }

  Future<void> _pickBirthday() async {
    final now = DateTime.now();
    var picked = DateTime(now.year - 18, now.month, now.day);
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) => SizedBox(
        height: 260,
        child: Column(
          children: [
            SizedBox(
              height: 200,
              child: CupertinoDatePicker(
                mode: CupertinoDatePickerMode.date,
                initialDateTime: picked,
                minimumDate: DateTime(now.year - 100),
                maximumDate: now,
                onDateTimeChanged: (value) => picked = value,
              ),
            ),
            SizedBox(
              width: double.infinity,
              child: TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
            ),
          ],
        ),
      ),
    );
    setState(() => _dateOfBirth = picked);
  }

  String? _validateUsername(String value) {
    if (value.length < 3 || value.length > 20) return '3-20 characters';
    if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9_]*$').hasMatch(value)) return 'Start with a letter; letters, digits, underscores only';
    return null;
  }

  Future<void> _submit() async {
    final dateOfBirth = _dateOfBirth;
    if (dateOfBirth == null) {
      setState(() => _errorMessage = 'Select your birthday');
      return;
    }
    final usernameError = _validateUsername(_usernameController.text.trim());
    if (usernameError != null) {
      setState(() => _errorMessage = usernameError);
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
      await ref.read(authControllerProvider.notifier).completeOAuthSignup(
            socialSignupToken: widget.socialSignupToken,
            dateOfBirth: dateOfBirth,
            username: _usernameController.text.trim(),
            displayName: _displayNameController.text.trim(),
          );
      // On success, GoRouter's redirect takes over — straight to Home,
      // since Profile was created in the same call.
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
        title: const Text('Complete your profile', style: TextStyle(color: Colors.black, fontWeight: FontWeight.w600)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 16),
              Center(
                child: CircleAvatar(
                  radius: 44,
                  backgroundColor: Colors.black12,
                  backgroundImage: widget.pictureUrl != null ? NetworkImage(widget.pictureUrl!) : null,
                  child: widget.pictureUrl == null ? const Icon(Icons.person, size: 44, color: Colors.black38) : null,
                ),
              ),
              const SizedBox(height: 24),
              TextFormField(
                controller: _displayNameController,
                decoration: const InputDecoration(labelText: 'Display name', border: OutlineInputBorder()),
                maxLength: 50,
              ),
              TextFormField(
                controller: _usernameController,
                decoration: const InputDecoration(labelText: 'Username', border: OutlineInputBorder(), prefixText: '@'),
                maxLength: 20,
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _pickBirthday,
                child: Text(_dateOfBirth == null ? "What's your birthday?" : 'Birthday: ${_dateOfBirth!.toIso8601String().split('T').first}'),
              ),
              const Text("Your birthday won't be shown publicly.", style: TextStyle(color: Colors.black54, fontSize: 12)),
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
                  style: FilledButton.styleFrom(backgroundColor: XnakColors.magenta, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26))),
                  onPressed: _isSubmitting ? null : _submit,
                  child: _isSubmitting
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Complete account', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
