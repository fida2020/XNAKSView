import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/xnak_colors.dart';
import 'auth_controller.dart';

class _CountryCode {
  const _CountryCode(this.name, this.dialCode, this.flag);
  final String name;
  final String dialCode;
  final String flag;
}

// A curated, real (not fake/placeholder) set of common country dial codes —
// not the complete ISO list, but every entry is accurate and functional.
// Easy to extend with more entries later without changing anything else.
const _countryCodes = [
  _CountryCode('Pakistan', '+92', '🇵🇰'),
  _CountryCode('United States', '+1', '🇺🇸'),
  _CountryCode('United Kingdom', '+44', '🇬🇧'),
  _CountryCode('India', '+91', '🇮🇳'),
  _CountryCode('United Arab Emirates', '+971', '🇦🇪'),
  _CountryCode('Saudi Arabia', '+966', '🇸🇦'),
  _CountryCode('Canada', '+1', '🇨🇦'),
  _CountryCode('Australia', '+61', '🇦🇺'),
];

/// Sign up — phone/email entry (brief §2). Phone → Continue and Email →
/// Continue both send a REAL server-generated OTP via `/auth/otp/request`
/// (brief §3 — OTP first, never a password at this step) and open the
/// verification screen. No password field exists on this screen at all.
class SignUpIdentifierScreen extends ConsumerStatefulWidget {
  const SignUpIdentifierScreen({super.key});

  @override
  ConsumerState<SignUpIdentifierScreen> createState() => _SignUpIdentifierScreenState();
}

class _SignUpIdentifierScreenState extends ConsumerState<SignUpIdentifierScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  _CountryCode _country = _countryCodes.first;

  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() => setState(() => _errorMessage = null));
  }

  @override
  void dispose() {
    _tabController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  bool get _isPhoneTab => _tabController.index == 0;

  String? _validate() {
    if (_isPhoneTab) {
      final digits = _phoneController.text.trim();
      if (digits.isEmpty) return 'Enter your phone number';
      if (!RegExp(r'^\d{7,14}$').hasMatch(digits)) return 'Enter a valid phone number';
    } else {
      final email = _emailController.text.trim();
      if (email.isEmpty) return 'Enter your email';
      if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) return 'Enter a valid email address';
    }
    return null;
  }

  Future<void> _continue() async {
    final validationError = _validate();
    if (validationError != null) {
      setState(() => _errorMessage = validationError);
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final email = _isPhoneTab ? null : _emailController.text.trim().toLowerCase();
    final phone = _isPhoneTab ? '${_country.dialCode}${_phoneController.text.trim()}' : null;

    try {
      final result = await ref.read(authControllerProvider.notifier).requestOtp(email: email, phone: phone, purpose: 'REGISTER');
      if (!mounted) return;
      context.pushOtpVerify(
        email: email,
        phone: phone,
        purpose: 'REGISTER',
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
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        foregroundColor: Colors.black,
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.of(context).maybePop()),
        title: const Text('Sign up', style: TextStyle(color: Colors.black, fontWeight: FontWeight.w600)),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              TabBar(
                controller: _tabController,
                labelColor: Colors.black,
                unselectedLabelColor: Colors.black45,
                indicatorColor: XnakColors.magenta,
                indicatorSize: TabBarIndicatorSize.label,
                tabs: const [Tab(text: 'Phone'), Tab(text: 'Email')],
                onTap: (_) => setState(() {}),
              ),
              const SizedBox(height: 24),
              if (_isPhoneTab) _buildPhoneField() else _buildEmailField(),
              const SizedBox(height: 12),
              Text(
                _isPhoneTab
                    ? 'We\'ll text a 6-digit code to verify your number.'
                    : 'We\'ll email a 6-digit code to verify your address.',
                style: const TextStyle(color: Colors.black54, fontSize: 12),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: XnakColors.magenta,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                  ),
                  onPressed: _isSubmitting ? null : _continue,
                  child: _isSubmitting
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Continue', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPhoneField() {
    return Container(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Colors.black.withValues(alpha: 0.15)))),
      child: Row(
        children: [
          InkWell(
            onTap: () async {
              final selected = await showModalBottomSheet<_CountryCode>(
                context: context,
                builder: (context) => ListView(
                  shrinkWrap: true,
                  children: [
                    for (final country in _countryCodes)
                      ListTile(
                        leading: Text(country.flag, style: const TextStyle(fontSize: 20)),
                        title: Text(country.name),
                        trailing: Text(country.dialCode),
                        onTap: () => Navigator.of(context).pop(country),
                      ),
                  ],
                ),
              );
              if (selected != null) setState(() => _country = selected);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                children: [
                  Text(_country.flag, style: const TextStyle(fontSize: 18)),
                  const SizedBox(width: 6),
                  Text(_country.dialCode, style: const TextStyle(fontSize: 16, color: Colors.black87)),
                  const SizedBox(width: 4),
                  const Icon(Icons.arrow_drop_down, color: Colors.black54),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              style: const TextStyle(fontSize: 16),
              decoration: const InputDecoration(border: InputBorder.none, hintText: 'Phone number'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailField() {
    return Container(
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Colors.black.withValues(alpha: 0.15)))),
      child: TextField(
        controller: _emailController,
        keyboardType: TextInputType.emailAddress,
        style: const TextStyle(fontSize: 16),
        decoration: const InputDecoration(border: InputBorder.none, hintText: 'Email'),
      ),
    );
  }
}
