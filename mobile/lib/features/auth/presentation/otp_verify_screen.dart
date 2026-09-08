import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/xnak_colors.dart';
import 'auth_controller.dart';

const _codeLength = 6;

/// OTP verification (brief §3 — IMPORTANT/critical) — the 6-digit code is
/// ALWAYS a real, server-generated code checked by the real backend
/// (`/auth/otp/verify`). There is no client-side bypass and no hardcoded
/// code anywhere in this screen or the layer beneath it. Shared between the
/// REGISTER flow (returns a `verificationToken` that the birthday/
/// credentials steps carry forward) and the LOGIN-with-code flow (completes
/// login immediately on a correct code).
class OtpVerifyScreen extends ConsumerStatefulWidget {
  const OtpVerifyScreen({
    super.key,
    required this.purpose,
    required this.maskedIdentifier,
    required this.resendAvailableInSeconds,
    this.email,
    this.phone,
  });

  final String? email;
  final String? phone;

  /// `'REGISTER'` or `'LOGIN'`.
  final String purpose;
  final String maskedIdentifier;
  final int resendAvailableInSeconds;

  @override
  ConsumerState<OtpVerifyScreen> createState() => _OtpVerifyScreenState();
}

class _OtpVerifyScreenState extends ConsumerState<OtpVerifyScreen> {
  late final List<TextEditingController> _controllers = List.generate(_codeLength, (_) => TextEditingController());
  late final List<FocusNode> _focusNodes = List.generate(_codeLength, (_) => FocusNode());

  Timer? _cooldownTimer;
  late int _secondsRemaining = widget.resendAvailableInSeconds;

  bool _isVerifying = false;
  bool _isResending = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _startCooldown(widget.resendAvailableInSeconds);
  }

  @override
  void dispose() {
    _cooldownTimer?.cancel();
    for (final controller in _controllers) {
      controller.dispose();
    }
    for (final node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  void _startCooldown(int seconds) {
    _cooldownTimer?.cancel();
    setState(() => _secondsRemaining = seconds);
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsRemaining <= 1) {
        timer.cancel();
        setState(() => _secondsRemaining = 0);
      } else {
        setState(() => _secondsRemaining -= 1);
      }
    });
  }

  String get _code => _controllers.map((c) => c.text).join();

  void _onDigitChanged(int index, String value) {
    // Paste support: a full 6-digit paste can land in a single field.
    if (value.length > 1) {
      final digits = value.replaceAll(RegExp(r'\D'), '');
      for (var i = 0; i < _codeLength; i += 1) {
        _controllers[i].text = i < digits.length ? digits[i] : '';
      }
      if (digits.length >= _codeLength) {
        _focusNodes[_codeLength - 1].requestFocus();
        _maybeAutoSubmit();
      } else if (digits.isNotEmpty) {
        _focusNodes[digits.length.clamp(0, _codeLength - 1)].requestFocus();
      }
      setState(() => _errorMessage = null);
      return;
    }

    setState(() => _errorMessage = null);
    if (value.isNotEmpty && index < _codeLength - 1) {
      _focusNodes[index + 1].requestFocus();
    }
    _maybeAutoSubmit();
  }

  void _onBackspace(int index) {
    if (_controllers[index].text.isEmpty && index > 0) {
      _focusNodes[index - 1].requestFocus();
      _controllers[index - 1].clear();
    }
  }

  void _maybeAutoSubmit() {
    if (_code.length == _codeLength && !_isVerifying) {
      _submit();
    }
  }

  Future<void> _submit() async {
    if (_code.length != _codeLength) return;

    setState(() {
      _isVerifying = true;
      _errorMessage = null;
    });

    try {
      if (widget.purpose == 'REGISTER') {
        final verificationToken = await ref
            .read(authControllerProvider.notifier)
            .verifyRegistrationOtp(email: widget.email, phone: widget.phone, code: _code);
        if (!mounted) return;
        context.pushSignUpBirthday(email: widget.email, phone: widget.phone, verificationToken: verificationToken);
      } else {
        await ref.read(authControllerProvider.notifier).loginWithOtp(email: widget.email, phone: widget.phone, code: _code);
        // On success, GoRouter's redirect (driven by AuthController state) takes over.
      }
    } on AppException catch (error) {
      setState(() => _errorMessage = error.message);
      for (final controller in _controllers) {
        controller.clear();
      }
      _focusNodes.first.requestFocus();
    } finally {
      if (mounted) setState(() => _isVerifying = false);
    }
  }

  Future<void> _resend() async {
    setState(() {
      _isResending = true;
      _errorMessage = null;
    });
    try {
      final result = await ref
          .read(authControllerProvider.notifier)
          .requestOtp(email: widget.email, phone: widget.phone, purpose: widget.purpose);
      for (final controller in _controllers) {
        controller.clear();
      }
      _focusNodes.first.requestFocus();
      _startCooldown(result.resendAvailableInSeconds);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A new code was sent.')));
      }
    } on AppException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isResending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canResend = _secondsRemaining <= 0 && !_isResending;

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
              const Text('Enter the 6-digit code', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.black)),
              const SizedBox(height: 8),
              Text('Sent to ${widget.maskedIdentifier}', style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 32),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: List.generate(_codeLength, (index) => _buildDigitBox(index)),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                Text(_errorMessage!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
              ],
              const SizedBox(height: 24),
              if (_isVerifying)
                const Center(child: CircularProgressIndicator())
              else
                Center(
                  child: TextButton(
                    onPressed: canResend ? _resend : null,
                    child: Text(
                      canResend ? 'Resend code' : 'Resend code in ${_secondsRemaining}s',
                      style: TextStyle(color: canResend ? XnakColors.magenta : Colors.black38, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDigitBox(int index) {
    return SizedBox(
      width: 44,
      height: 52,
      // An empty field's onChanged never fires for a backspace press, so
      // backspace-to-previous-box needs the raw key event instead.
      child: KeyboardListener(
        focusNode: FocusNode(skipTraversal: true, canRequestFocus: false),
        onKeyEvent: (event) {
          if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.backspace && _controllers[index].text.isEmpty) {
            _onBackspace(index);
          }
        },
        child: TextField(
          controller: _controllers[index],
          focusNode: _focusNodes[index],
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          maxLength: index == 0 ? _codeLength : 1, // box 0 also accepts a full pasted code
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(
            counterText: '',
            contentPadding: EdgeInsets.zero,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.black26)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: XnakColors.magenta, width: 2)),
          ),
          onChanged: (value) => _onDigitChanged(index, value),
          onTap: () => _controllers[index].selection = TextSelection(baseOffset: 0, extentOffset: _controllers[index].text.length),
          onSubmitted: (_) => _maybeAutoSubmit(),
        ),
      ),
    );
  }
}
