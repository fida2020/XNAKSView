import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/creator_economy_models.dart';
import 'coins_providers.dart';
import 'creator_economy_providers.dart';

/// Step 1 of the withdrawal flow — "Bank Account". Country picked from the
/// server's own enabled-country list (never hardcoded here), then dynamic
/// per-country fields fetched from `GET /creator/payout-method/schema`. No
/// provider/rail is ever selectable — the backend decides that
/// automatically once the bank account is submitted.
class BankAccountScreen extends ConsumerStatefulWidget {
  const BankAccountScreen({super.key});

  @override
  ConsumerState<BankAccountScreen> createState() => _BankAccountScreenState();
}

class _BankAccountScreenState extends ConsumerState<BankAccountScreen> {
  List<PayoutCountryOption>? _countries;
  String? _countriesError;

  PayoutCountryOption? _selectedCountry;
  List<BankFieldModel>? _fields;
  bool _isLoadingFields = false;
  String? _fieldsError;

  final _accountHolderController = TextEditingController();
  final Map<String, TextEditingController> _fieldControllers = {};

  bool _isSubmitting = false;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    _loadCountries();
  }

  @override
  void dispose() {
    _accountHolderController.dispose();
    for (final controller in _fieldControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadCountries() async {
    setState(() => _countriesError = null);
    try {
      final countries = await ref.read(creatorEconomyRepositoryProvider).fetchPayoutCountries();
      if (mounted) setState(() => _countries = countries);
    } on AppException catch (error) {
      if (mounted) setState(() => _countriesError = error.message);
    }
  }

  Future<void> _onCountrySelected(PayoutCountryOption? country) async {
    setState(() {
      _selectedCountry = country;
      _fields = null;
      _fieldsError = null;
      for (final controller in _fieldControllers.values) {
        controller.dispose();
      }
      _fieldControllers.clear();
    });
    if (country == null) return;

    setState(() => _isLoadingFields = true);
    try {
      final fields = await ref
          .read(creatorEconomyRepositoryProvider)
          .fetchPayoutMethodSchema(country: country.countryCode, currency: country.currency);
      if (!mounted) return;
      setState(() {
        _fields = fields;
        for (final field in fields) {
          _fieldControllers[field.key] = TextEditingController();
        }
      });
    } on AppException catch (error) {
      if (mounted) setState(() => _fieldsError = error.message);
    } finally {
      if (mounted) setState(() => _isLoadingFields = false);
    }
  }

  Future<void> _submit() async {
    final country = _selectedCountry;
    final fields = _fields;
    if (country == null || fields == null) return;

    if (_accountHolderController.text.trim().isEmpty) {
      setState(() => _submitError = 'Enter the account holder name.');
      return;
    }
    for (final field in fields) {
      if (field.required && _fieldControllers[field.key]!.text.trim().isEmpty) {
        setState(() => _submitError = '${field.label} is required.');
        return;
      }
    }

    setState(() {
      _isSubmitting = true;
      _submitError = null;
    });
    try {
      final bankDetails = {for (final field in fields) field.key: _fieldControllers[field.key]!.text.trim()};
      final result = await ref.read(creatorEconomyRepositoryProvider).addPayoutMethod(
            country: country.countryCode,
            currency: country.currency,
            accountHolderName: _accountHolderController.text.trim(),
            bankDetails: bankDetails,
          );
      await ref.read(payoutMethodProvider.notifier).refresh();
      if (!mounted) return;
      if (result.status == 'REJECTED') {
        setState(() => _submitError = result.rejectionReason ?? 'This bank account could not be verified.');
        return;
      }
      Navigator.of(context).pop(true);
    } on AppException catch (error) {
      if (mounted) setState(() => _submitError = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Bank account')),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_countriesError != null) {
      return AppErrorWidget(message: _countriesError!, onRetry: _loadCountries);
    }
    final countries = _countries;
    if (countries == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (countries.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('Payouts aren\'t configured for any country yet. Please check back later.', textAlign: TextAlign.center),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('Country', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        DropdownButtonFormField<PayoutCountryOption>(
          initialValue: _selectedCountry,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Select your country'),
          items: [for (final c in countries) DropdownMenuItem(value: c, child: Text('${c.countryCode} (${c.currency})'))],
          onChanged: _onCountrySelected,
        ),
        const SizedBox(height: 20),
        if (_isLoadingFields) const Center(child: CircularProgressIndicator()),
        if (_fieldsError != null) Text(_fieldsError!, style: const TextStyle(color: Colors.redAccent)),
        if (_fields != null) ..._buildFields(),
        if (_submitError != null) ...[
          const SizedBox(height: 12),
          Text(_submitError!, style: const TextStyle(color: Colors.redAccent)),
        ],
        const SizedBox(height: 24),
        if (_fields != null)
          FilledButton(
            onPressed: _isSubmitting ? null : _submit,
            child: _isSubmitting
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save bank account'),
          ),
      ],
    );
  }

  List<Widget> _buildFields() {
    return [
      const Text('Account holder name', style: TextStyle(fontWeight: FontWeight.bold)),
      const SizedBox(height: 8),
      TextField(controller: _accountHolderController, decoration: const InputDecoration(border: OutlineInputBorder())),
      const SizedBox(height: 16),
      for (final field in _fields!) ...[
        Text(field.label, style: const TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        TextField(controller: _fieldControllers[field.key], decoration: const InputDecoration(border: OutlineInputBorder())),
        const SizedBox(height: 16),
      ],
    ];
  }
}
