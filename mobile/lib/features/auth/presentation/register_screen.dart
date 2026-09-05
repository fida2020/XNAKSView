import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import 'auth_controller.dart';

enum _Identifier { email, phone }

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _credentialsFormKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  _Identifier _identifier = _Identifier.email;
  bool _obscurePassword = true;
  int _step = 0;
  DateTime? _dateOfBirth;
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
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

  void _goToDateOfBirthStep() {
    if (!_credentialsFormKey.currentState!.validate()) return;
    if (_passwordController.text != _confirmPasswordController.text) {
      setState(() => _errorMessage = 'Passwords do not match');
      return;
    }
    setState(() {
      _errorMessage = null;
      _step = 1;
    });
  }

  Future<void> _pickDateOfBirth() async {
    final now = DateTime.now();
    final initial = DateTime(now.year - 18, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 100),
      lastDate: now,
      helpText: 'Date of birth',
    );
    if (picked != null) {
      setState(() => _dateOfBirth = picked);
    }
  }

  Future<void> _submit() async {
    final dateOfBirth = _dateOfBirth;
    if (dateOfBirth == null) {
      setState(() => _errorMessage = 'Date of birth is required');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).register(
            email: _identifier == _Identifier.email ? _identifierController.text.trim() : null,
            phone: _identifier == _Identifier.phone ? _identifierController.text.trim() : null,
            password: _passwordController.text,
            dateOfBirth: dateOfBirth,
          );
      // On success, GoRouter's redirect takes over (to profile setup).
    } on AppException catch (error) {
      setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_step == 0 ? 'Create your ${AppConfig.appName} account' : 'Confirm your age'),
        leading: _step == 1
            ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _step = 0))
            : null,
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _step == 0 ? _buildCredentialsStep() : _buildDateOfBirthStep(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCredentialsStep() {
    return Form(
      key: _credentialsFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<_Identifier>(
            segments: const [
              ButtonSegment(value: _Identifier.email, label: Text('Email')),
              ButtonSegment(value: _Identifier.phone, label: Text('Phone')),
            ],
            selected: {_identifier},
            onSelectionChanged: (selection) => setState(() {
              _identifier = selection.first;
              _identifierController.clear();
            }),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _identifierController,
            keyboardType: _identifier == _Identifier.email ? TextInputType.emailAddress : TextInputType.phone,
            decoration: InputDecoration(
              labelText: _identifier == _Identifier.email ? 'Email' : 'Phone (e.g. +14155552671)',
              border: const OutlineInputBorder(),
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) return 'Required';
              if (_identifier == _Identifier.email && !value.contains('@')) return 'Enter a valid email';
              if (_identifier == _Identifier.phone && !RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(value.trim())) {
                return 'Use E.164 format, e.g. +14155552671';
              }
              return null;
            },
          ),
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
              helperText: 'At least 10 characters, with upper/lowercase, a digit, and a symbol',
              helperMaxLines: 2,
            ),
            validator: _validatePassword,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _confirmPasswordController,
            obscureText: _obscurePassword,
            decoration: const InputDecoration(labelText: 'Confirm password', border: OutlineInputBorder()),
            validator: (value) => (value == null || value.isEmpty) ? 'Required' : null,
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton(onPressed: _goToDateOfBirthStep, child: const Text('Continue')),
        ],
      ),
    );
  }

  Widget _buildDateOfBirthStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.cake_outlined, size: 48),
        const SizedBox(height: 12),
        Text(
          'You must be 18 or older to use ${AppConfig.appName}.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 20),
        OutlinedButton(
          onPressed: _isSubmitting ? null : _pickDateOfBirth,
          child: Text(
            _dateOfBirth == null
                ? 'Select date of birth'
                : 'Date of birth: ${_dateOfBirth!.toIso8601String().split('T').first}',
          ),
        ),
        Text(
          'Your age is verified by our servers — it cannot be changed after signup.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_errorMessage != null) ...[
          const SizedBox(height: 12),
          Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error), textAlign: TextAlign.center),
        ],
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _isSubmitting ? null : _submit,
          child: _isSubmitting
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Create account'),
        ),
      ],
    );
  }
}
