import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/creator_economy_models.dart';
import 'bank_account_screen.dart';
import 'coins_providers.dart';
import 'creator_economy_providers.dart';
import 'identity_verification_screen.dart';
import 'withdraw_amount_screen.dart';

/// Unified withdrawal hub — Balance -> Bank Account -> Verification ->
/// Amount -> Fee/FX/Net preview -> Withdraw -> Status -> History (brief's
/// TikTok-style flow). The creator never sees or picks a payout
/// provider/rail — the backend decides that automatically per
/// country/currency/verified method (see `lib/withdrawalOrchestrator.ts`).
/// Every status shown below (PROCESSING/PAID/FAILED/REJECTED/CANCELLED) is
/// real backend state — PAID only ever follows a real provider webhook
/// confirmation, never an optimistic guess.
class WithdrawalScreen extends ConsumerStatefulWidget {
  const WithdrawalScreen({super.key});

  @override
  ConsumerState<WithdrawalScreen> createState() => _WithdrawalScreenState();
}

class _WithdrawalScreenState extends ConsumerState<WithdrawalScreen> {
  List<WithdrawalModel> _withdrawals = [];
  bool _isLoadingHistory = true;
  String? _historyError;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _isLoadingHistory = true;
      _historyError = null;
    });
    try {
      final page = await ref.read(creatorEconomyRepositoryProvider).fetchWithdrawals();
      if (mounted) setState(() => _withdrawals = page.withdrawals);
    } on AppException catch (error) {
      if (mounted) setState(() => _historyError = error.message);
    } finally {
      if (mounted) setState(() => _isLoadingHistory = false);
    }
  }

  Future<void> _refreshAll() async {
    await Future.wait([
      ref.read(earningsBalanceProvider.notifier).refresh(),
      ref.read(payoutMethodProvider.notifier).refresh(),
      ref.read(identityVerificationProvider.notifier).refresh(),
      _loadHistory(),
    ]);
  }

  Future<void> _cancel(WithdrawalModel withdrawal) async {
    try {
      await ref.read(creatorEconomyRepositoryProvider).cancelWithdrawal(withdrawal.id);
      await ref.read(earningsBalanceProvider.notifier).refresh();
      await _loadHistory();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  /// Bank Account -> Verification -> Amount, skipping any step already
  /// complete. Each step's own screen re-checks eligibility server-side
  /// regardless of what this client-side routing assumes.
  Future<void> _startWithdrawFlow() async {
    var payoutMethod = ref.read(payoutMethodProvider).valueOrNull;
    if (payoutMethod == null || !payoutMethod.isVerified) {
      final added = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const BankAccountScreen()));
      if (added != true || !mounted) return;
      payoutMethod = ref.read(payoutMethodProvider).valueOrNull;
      if (payoutMethod == null) return;
    }

    var verification = ref.read(identityVerificationProvider).valueOrNull;
    if (verification == null || !verification.isApproved) {
      final approved = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => IdentityVerificationScreen(country: payoutMethod!.country)),
      );
      if (approved != true || !mounted) return;
      verification = ref.read(identityVerificationProvider).valueOrNull;
      if (verification == null || !verification.isApproved) return;
    }

    final earnings = ref.read(earningsBalanceProvider).valueOrNull;
    final submitted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => WithdrawAmountScreen(availableMinorUnits: earnings?.balanceMinorUnits ?? 0, currency: earnings?.currency ?? 'USD'),
      ),
    );
    if (submitted == true) await _refreshAll();
  }

  @override
  Widget build(BuildContext context) {
    final earnings = ref.watch(earningsBalanceProvider);
    final payoutMethod = ref.watch(payoutMethodProvider);
    final verification = ref.watch(identityVerificationProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Withdrawals')),
      body: RefreshIndicator(
        onRefresh: _refreshAll,
        child: ListView(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Available earnings', style: TextStyle(color: Colors.black54)),
                        earnings.when(
                          data: (value) => Text(
                            '${(value.balanceMinorUnits / 100).toStringAsFixed(2)} ${value.currency}',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                          ),
                          loading: () => const Text('…'),
                          error: (_, _) => const Text('—'),
                        ),
                      ],
                    ),
                  ),
                  FilledButton(onPressed: _startWithdrawFlow, child: const Text('Withdraw')),
                ],
              ),
            ),
            const Divider(height: 1),
            _buildStatusRow(
              icon: Icons.account_balance_outlined,
              label: 'Bank account',
              value: payoutMethod.when(
                data: (method) => method == null ? 'Not added' : '${_payoutMethodStatusLabel(method.status)} · ${method.country}',
                loading: () => '…',
                error: (_, _) => '—',
              ),
            ),
            _buildStatusRow(
              icon: Icons.verified_user_outlined,
              label: 'Verification',
              value: verification.when(
                data: (v) => v == null ? 'Not started' : _identityStatusLabel(v.status),
                loading: () => '…',
                error: (_, _) => '—',
              ),
            ),
            const Divider(height: 1),
            _buildHistory(),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusRow({required IconData icon, required String label, required String value}) {
    return ListTile(dense: true, leading: Icon(icon, size: 20), title: Text(label), trailing: Text(value, style: const TextStyle(color: Colors.black54)));
  }

  Widget _buildHistory() {
    if (_isLoadingHistory) {
      return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
    }
    if (_historyError != null) {
      return AppErrorWidget(message: _historyError!, onRetry: _loadHistory);
    }
    if (_withdrawals.isEmpty) {
      return const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No withdrawal requests yet.')));
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: _withdrawals.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final withdrawal = _withdrawals[index];
        final reason = withdrawal.rejectionReason ?? withdrawal.failureReason;
        return ListTile(
          leading: const Icon(Icons.account_balance_outlined),
          title: Text(withdrawal.formattedAmount),
          subtitle: Text('${_formatDate(withdrawal.createdAt)}${reason != null ? '\n$reason' : ''}'),
          isThreeLine: reason != null,
          trailing: withdrawal.isCancellable
              ? TextButton(onPressed: () => _cancel(withdrawal), child: const Text('Cancel'))
              : Chip(label: Text(withdrawal.statusLabel)),
        );
      },
    );
  }
}

String _payoutMethodStatusLabel(PayoutMethodStatus status) {
  switch (status) {
    case PayoutMethodStatus.pendingVerification:
      return 'Pending';
    case PayoutMethodStatus.verified:
      return 'Verified';
    case PayoutMethodStatus.rejected:
      return 'Rejected';
    case PayoutMethodStatus.disabled:
      return 'Disabled';
    case PayoutMethodStatus.unknown:
      return 'Unknown';
  }
}

String _identityStatusLabel(IdentityVerificationStatus status) {
  switch (status) {
    case IdentityVerificationStatus.pending:
      return 'Pending';
    case IdentityVerificationStatus.approved:
      return 'Verified';
    case IdentityVerificationStatus.rejected:
      return 'Rejected';
    case IdentityVerificationStatus.expired:
      return 'Expired';
    case IdentityVerificationStatus.unknown:
      return 'Unknown';
  }
}

String _formatDate(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}
