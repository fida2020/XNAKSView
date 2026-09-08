import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import 'coins_providers.dart';

/// A self-set daily Gift spending cap — current TikTok's Help Center
/// documents this as a personal budgeting control, not a platform-mandated
/// limit (verified before implementing; see backend `CoinWallet
/// .dailyGiftLimitCoins`'s schema comment). Enforced server-side on every
/// Gift send (`lib/giftService.ts`); this sheet only reads/writes that
/// value — it can't be a client-only fake limit because there's nothing
/// for the client to enforce, the server already does.
Future<void> showDailyGiftLimitSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => const _DailyGiftLimitSheet(),
  );
}

class _DailyGiftLimitSheet extends ConsumerStatefulWidget {
  const _DailyGiftLimitSheet();

  @override
  ConsumerState<_DailyGiftLimitSheet> createState() => _DailyGiftLimitSheetState();
}

class _DailyGiftLimitSheetState extends ConsumerState<_DailyGiftLimitSheet> {
  final _controller = TextEditingController();
  bool _enabled = false;
  bool _isLoading = true;
  bool _isSaving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final balance = await ref.read(coinsRepositoryProvider).fetchBalance();
      if (!mounted) return;
      setState(() {
        _enabled = balance.dailyGiftLimitCoins != null;
        if (balance.dailyGiftLimitCoins != null) {
          _controller.text = '${balance.dailyGiftLimitCoins}';
        }
      });
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _save() async {
    final limit = _enabled ? int.tryParse(_controller.text.trim()) : null;
    if (_enabled && (limit == null || limit <= 0)) {
      setState(() => _error = 'Enter a valid Coin amount above zero.');
      return;
    }

    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      await ref.read(coinsRepositoryProvider).setDailyGiftLimit(limit);
      if (mounted) Navigator.of(context).pop();
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
        child: _isLoading
            ? const SizedBox(height: 120, child: Center(child: CircularProgressIndicator()))
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Daily Gift limit', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text(
                    'A personal budgeting control — set a maximum you can spend on Gifts per day. This is not a platform limit.',
                    style: TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 16),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Set a daily limit'),
                    value: _enabled,
                    onChanged: (value) => setState(() => _enabled = value),
                  ),
                  if (_enabled)
                    TextField(
                      controller: _controller,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Max Coins per day', border: OutlineInputBorder()),
                    ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                  ],
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _isSaving ? null : _save,
                      child: _isSaving
                          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Save'),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
