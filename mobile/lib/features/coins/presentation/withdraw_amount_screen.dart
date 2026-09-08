import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/creator_economy_models.dart';
import 'coins_providers.dart';
import 'creator_economy_providers.dart';

/// Step 3/4 of the withdrawal flow — "Amount" then "Fee/FX/Net preview".
/// The preview is fetched fresh from the server every time the amount
/// changes (debounced) — the client never computes fee/net itself. PAID is
/// never shown here: submission only ever returns the withdrawal's initial
/// automatic-pipeline status (PROCESSING, or FAILED/REJECTED if refused
/// outright) — real confirmation always arrives later via provider webhook.
class WithdrawAmountScreen extends ConsumerStatefulWidget {
  const WithdrawAmountScreen({required this.availableMinorUnits, required this.currency, super.key});

  final int availableMinorUnits;
  final String currency;

  @override
  ConsumerState<WithdrawAmountScreen> createState() => _WithdrawAmountScreenState();
}

class _WithdrawAmountScreenState extends ConsumerState<WithdrawAmountScreen> {
  final _amountController = TextEditingController();
  Timer? _debounce;

  WithdrawalPreviewModel? _preview;
  bool _isLoadingPreview = false;
  String? _previewError;

  bool _isSubmitting = false;
  String? _submitError;

  @override
  void dispose() {
    _amountController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onAmountChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), _loadPreview);
  }

  Future<void> _loadPreview() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() {
        _preview = null;
        _previewError = null;
      });
      return;
    }

    setState(() {
      _isLoadingPreview = true;
      _previewError = null;
    });
    try {
      final preview = await ref.read(creatorEconomyRepositoryProvider).fetchWithdrawalPreview(amountMinorUnits: (amount * 100).round());
      if (mounted) setState(() => _preview = preview);
    } on AppException catch (error) {
      if (mounted) {
        setState(() {
          _preview = null;
          _previewError = error.message;
        });
      }
    } finally {
      if (mounted) setState(() => _isLoadingPreview = false);
    }
  }

  Future<void> _submit() async {
    final preview = _preview;
    if (preview == null) return;

    setState(() {
      _isSubmitting = true;
      _submitError = null;
    });
    try {
      final idempotencyKey = 'withdrawal-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';
      final result = await ref.read(creatorEconomyRepositoryProvider).requestWithdrawal(
            amountMinorUnits: preview.amountMinorUnits,
            currency: preview.currency,
            idempotencyKey: idempotencyKey,
          );
      await ref.read(earningsBalanceProvider.notifier).refresh();
      if (!mounted) return;
      if (result.status == 'REJECTED' || result.status == 'FAILED') {
        setState(() => _submitError = result.rejectionReason ?? result.failureReason ?? 'This withdrawal could not be started.');
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
      appBar: AppBar(title: const Text('Withdraw')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Available: ${(widget.availableMinorUnits / 100).toStringAsFixed(2)} ${widget.currency}', style: const TextStyle(color: Colors.black54)),
            const SizedBox(height: 16),
            TextField(
              controller: _amountController,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: _onAmountChanged,
              decoration: InputDecoration(labelText: 'Amount (${widget.currency})', border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 20),
            if (_isLoadingPreview) const Center(child: CircularProgressIndicator()),
            if (_previewError != null) Text(_previewError!, style: const TextStyle(color: Colors.redAccent)),
            if (_preview != null) _buildPreview(_preview!),
            const Spacer(),
            if (_submitError != null) ...[
              Text(_submitError!, style: const TextStyle(color: Colors.redAccent)),
              const SizedBox(height: 12),
            ],
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: (_preview == null || _isSubmitting) ? null : _submit,
                child: _isSubmitting
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Withdraw'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview(WithdrawalPreviewModel preview) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.grey.shade100, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _previewRow('Amount', preview.formattedAmount),
          _previewRow('Fee', '- ${preview.formattedFee}'),
          const Divider(),
          _previewRow('You receive', preview.formattedNet, bold: true),
          const SizedBox(height: 8),
          Text('Estimated ${preview.estimatedProcessingDays} business day(s)', style: const TextStyle(color: Colors.black54, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _previewRow(String label, String value, {bool bold = false}) {
    final style = TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [Text(label, style: style), Text(value, style: style)],
      ),
    );
  }
}
