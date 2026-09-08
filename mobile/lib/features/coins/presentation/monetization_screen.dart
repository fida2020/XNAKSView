import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../../../core/widgets/xnak_coin_icon.dart';
import '../domain/monetization_models.dart';
import 'coin_theme.dart';
import 'coins_providers.dart';
import 'creator_economy_providers.dart';
import 'withdrawal_screen.dart';

/// Creator Monetization (Step 8 — ad revenue). Status/eligibility/share %
/// are entirely server-computed; this screen only ever displays what the
/// backend returned. LIVE Rewards/Diamonds (Step 7) stay a visibly
/// separate balance from ad revenue — both feed the SAME eligible
/// Earnings/Reward balance (`CreatorEarningsWallet`), never a second
/// wallet, but the UI never merges "why you earned this" into one number.
class MonetizationScreen extends ConsumerStatefulWidget {
  const MonetizationScreen({super.key});

  @override
  ConsumerState<MonetizationScreen> createState() => _MonetizationScreenState();
}

class _MonetizationScreenState extends ConsumerState<MonetizationScreen> {
  MonetizationStatusModel? _status;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final status = await ref.read(monetizationRepositoryProvider).fetchStatus();
      if (mounted) setState(() => _status = status);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Monetization')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? AppErrorWidget(message: _error!, onRetry: _load)
              : _status == null
                  ? const SizedBox.shrink()
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          _StatusCard(status: _status!),
                          const SizedBox(height: 16),
                          if (!_isActive) _EligibilityCard(status: _status!),
                          if (!_isActive) const SizedBox(height: 16),
                          const _EarningsCard(),
                          const SizedBox(height: 16),
                          const _RevenueHistorySection(),
                        ],
                      ),
                    ),
    );
  }

  bool get _isActive => _status?.status == MonetizationStatus.active;
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});

  final MonetizationStatusModel status;

  /// TikTok-style creator-facing copy — describes what the status MEANS
  /// for the creator, never a raw internal revenue-share number (that
  /// accounting detail stays server-side/admin-only).
  String _descriptionFor(MonetizationStatus s) => switch (s) {
        MonetizationStatus.active => 'You\'re earning rewards from ads shown on your eligible videos.',
        MonetizationStatus.eligible => 'You meet the requirements for the Creator Rewards Program. An admin will review your account to activate rewards.',
        MonetizationStatus.pendingReview => 'Your account is under review for the Creator Rewards Program.',
        MonetizationStatus.suspended => 'Rewards are temporarily paused on your account.',
        MonetizationStatus.disabled => 'Rewards are turned off for your account.',
        MonetizationStatus.notEligible || MonetizationStatus.unknown => 'Keep creating great content to unlock rewards from your videos.',
      };

  Color _colorFor(MonetizationStatus s) => switch (s) {
        MonetizationStatus.active => Colors.green,
        MonetizationStatus.pendingReview => Colors.orange,
        MonetizationStatus.eligible => CoinTheme.magenta,
        MonetizationStatus.suspended || MonetizationStatus.disabled => Colors.redAccent,
        _ => Colors.grey,
      };

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(status.status);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20), border: Border.all(color: color.withValues(alpha: 0.3))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.monetization_on_outlined, color: color),
              const SizedBox(width: 8),
              Text(status.status.label, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ),
          const SizedBox(height: 12),
          Text(_descriptionFor(status.status), style: const TextStyle(fontWeight: FontWeight.w500)),
          if (status.statusReason != null) ...[
            const SizedBox(height: 6),
            Text(status.statusReason!, style: const TextStyle(color: Colors.black54, fontSize: 13)),
          ],
          if (status.activatedAt != null) ...[
            const SizedBox(height: 4),
            Text('Monetized since ${_formatDate(status.activatedAt!)}', style: const TextStyle(color: Colors.black54, fontSize: 12)),
          ],
        ],
      ),
    );
  }
}

class _EligibilityCard extends StatelessWidget {
  const _EligibilityCard({required this.status});

  final MonetizationStatusModel status;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.black12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Eligibility requirements', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 8),
          for (final requirement in status.requirements)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Icon(requirement.met ? Icons.check_circle : Icons.radio_button_unchecked, color: requirement.met ? Colors.green : Colors.black38, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${requirement.label}: ${requirement.current} / ${requirement.required}')),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _EarningsCard extends ConsumerWidget {
  const _EarningsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final earnings = ref.watch(earningsBalanceProvider);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: const Color(0xFFEEEEEE), borderRadius: BorderRadius.circular(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Eligible reward balance', style: TextStyle(color: Colors.black54, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          earnings.when(
            data: (value) => Text('\$${(value.balanceMinorUnits / 100).toStringAsFixed(2)}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
            loading: () => const SizedBox(height: 32, width: 32, child: CircularProgressIndicator(strokeWidth: 3)),
            error: (_, _) => const Text('—', style: TextStyle(fontSize: 32)),
          ),
          const SizedBox(height: 4),
          const Text('From ad revenue + LIVE rewards, combined into one eligible balance', style: TextStyle(color: Colors.black45, fontSize: 12)),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const WithdrawalScreen())),
                  child: const Text('Withdraw'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Colors.black87),
                  onPressed: () => _showExchangeDialog(context, ref),
                  child: const Text('Exchange to Coins'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _showExchangeDialog(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (context) => const _ExchangeToCoinsSheet());
  }
}

class _ExchangeToCoinsSheet extends ConsumerStatefulWidget {
  const _ExchangeToCoinsSheet();

  @override
  ConsumerState<_ExchangeToCoinsSheet> createState() => _ExchangeToCoinsSheetState();
}

class _ExchangeToCoinsSheetState extends ConsumerState<_ExchangeToCoinsSheet> {
  bool _isLoadingPreview = true;
  bool _isSubmitting = false;
  String? _error;
  int _amountMinorUnits = 0;
  String _currency = 'USD';
  int _coins = 0;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  Future<void> _loadPreview() async {
    setState(() {
      _isLoadingPreview = true;
      _error = null;
    });
    try {
      final preview = await ref.read(creatorEconomyRepositoryProvider).previewExchangeToCoins();
      if (mounted) {
        setState(() {
          _amountMinorUnits = preview.amountMinorUnits;
          _currency = preview.currency;
          _coins = preview.coins;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoadingPreview = false);
    }
  }

  Future<void> _confirm() async {
    if (_amountMinorUnits <= 0) return;
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final idempotencyKey = 'exchange-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';
      final result = await ref.read(creatorEconomyRepositoryProvider).exchangeToCoins(amountMinorUnits: _amountMinorUnits, currency: _currency, idempotencyKey: idempotencyKey);
      ref.read(coinBalanceProvider.notifier).applyKnownBalance(result.coinBalance);
      await ref.read(earningsBalanceProvider.notifier).refresh();
      if (mounted) Navigator.of(context).pop();
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Exchange to Coins', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            if (_isLoadingPreview)
              const Center(child: CircularProgressIndicator())
            else ...[
              Text(
                'Exchange \$${(_amountMinorUnits / 100).toStringAsFixed(2)} reward balance for $_coins Coins?',
                style: const TextStyle(fontSize: 16),
              ),
              const SizedBox(height: 8),
              Row(children: [const XnakCoinIcon(size: 18), const SizedBox(width: 6), Text('$_coins Coins', style: const TextStyle(fontWeight: FontWeight.bold))]),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: (_isSubmitting || _amountMinorUnits <= 0) ? null : _confirm,
                  child: _isSubmitting
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Confirm Exchange'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _RevenueHistorySection extends ConsumerStatefulWidget {
  const _RevenueHistorySection();

  @override
  ConsumerState<_RevenueHistorySection> createState() => _RevenueHistorySectionState();
}

class _RevenueHistorySectionState extends ConsumerState<_RevenueHistorySection> {
  List<AdRevenueEventModel> _entries = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final page = await ref.read(monetizationRepositoryProvider).fetchRevenueHistory();
      if (mounted) setState(() => _entries = page.entries);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Ad revenue', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 8),
        if (_isLoading)
          const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
        else if (_error != null)
          AppErrorWidget(message: _error!, onRetry: _load)
        else if (_entries.isEmpty)
          const Padding(padding: EdgeInsets.all(16), child: Text('No ad revenue recorded yet.', style: TextStyle(color: Colors.black54)))
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _entries.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final entry = _entries[index];
              final creatorAmount = entry.creatorShareMinorUnits / 100;
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(entry.isReversal ? Icons.undo : Icons.ondemand_video_outlined, color: entry.isReversal ? Colors.redAccent : (entry.wasMonetizationActive ? Colors.green : Colors.black38)),
                title: Text(entry.isReversal ? 'Revenue reversed' : (entry.wasMonetizationActive ? 'Ad revenue share' : 'Ad revenue (not yet monetized)')),
                subtitle: Text('${entry.provider} · ${_formatDate(entry.createdAt)}'),
                trailing: Text(
                  '${creatorAmount >= 0 ? '+' : ''}\$${creatorAmount.toStringAsFixed(2)}',
                  style: TextStyle(fontWeight: FontWeight.bold, color: creatorAmount > 0 ? Colors.green : (creatorAmount < 0 ? Colors.redAccent : Colors.black38)),
                ),
              );
            },
          ),
      ],
    );
  }
}

String _formatDate(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}
