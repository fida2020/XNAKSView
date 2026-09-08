import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/creator_economy_models.dart';
import 'coin_theme.dart';
import 'coins_providers.dart';
import 'creator_economy_providers.dart';
import 'monetization_screen.dart';
import 'withdrawal_screen.dart';

/// Creator-facing Diamonds/Earnings (brief §9) — Diamonds and cash-
/// equivalent earnings are shown as two separate balances/histories, never
/// merged into one number (backend keeps them in entirely separate
/// wallets/ledgers — see `CreatorEarningsWallet`'s schema comment).
///
/// There is deliberately NO button anywhere on this screen that converts
/// Diamonds into earnings — that conversion only happens admin-side
/// (`POST /admin/creators/:id/diamonds/convert`) using a rate the creator
/// never sees a client control for, per brief §9/§24.
class CreatorEarningsScreen extends ConsumerStatefulWidget {
  const CreatorEarningsScreen({super.key});

  @override
  ConsumerState<CreatorEarningsScreen> createState() => _CreatorEarningsScreenState();
}

class _CreatorEarningsScreenState extends ConsumerState<CreatorEarningsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('XNAKView Studio')),
      body: Column(
        children: [
          const _BalancesRow(),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MonetizationScreen())),
                    icon: const Icon(Icons.monetization_on_outlined),
                    label: const Text('Monetization'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const WithdrawalScreen())),
                    icon: const Icon(Icons.account_balance_wallet_outlined),
                    label: const Text('Withdrawals'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          TabBar(controller: _tabController, tabs: const [Tab(text: 'Diamonds'), Tab(text: 'Earnings')]),
          Expanded(
            child: TabBarView(controller: _tabController, children: const [_DiamondHistoryTab(), _EarningsHistoryTab()]),
          ),
        ],
      ),
    );
  }
}

class _BalancesRow extends ConsumerWidget {
  const _BalancesRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final diamonds = ref.watch(diamondBalanceProvider);
    final earnings = ref.watch(earningsBalanceProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: Row(
        children: [
          Expanded(
            child: _BalanceTile(
              gradient: CoinTheme.diamondGradient,
              icon: Icons.diamond,
              label: 'Diamonds',
              value: diamonds.when(
                data: (value) => '$value',
                loading: () => '…',
                error: (_, _) => '—',
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _BalanceTile(
              gradient: const LinearGradient(colors: [Color(0xFF34D399), Color(0xFF059669)]),
              icon: Icons.savings,
              label: 'Earnings',
              value: earnings.when(
                data: (value) => (value.balanceMinorUnits / 100).toStringAsFixed(2),
                loading: () => '…',
                error: (_, _) => '—',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BalanceTile extends StatelessWidget {
  const _BalanceTile({required this.gradient, required this.icon, required this.label, required this.value});

  final Gradient gradient;
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(gradient: gradient, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white),
          const SizedBox(height: 8),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _DiamondHistoryTab extends ConsumerStatefulWidget {
  const _DiamondHistoryTab();

  @override
  ConsumerState<_DiamondHistoryTab> createState() => _DiamondHistoryTabState();
}

class _DiamondHistoryTabState extends ConsumerState<_DiamondHistoryTab> {
  List<DiamondLedgerEntryModel> _entries = [];
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
      final page = await ref.read(creatorEconomyRepositoryProvider).fetchDiamondHistory();
      if (mounted) setState(() => _entries = page.entries);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return AppErrorWidget(message: _error!, onRetry: _load);
    if (_entries.isEmpty) return const Center(child: Text('No Diamonds yet — they\'re earned from Gifts you receive.'));

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: _entries.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final entry = _entries[index];
          final isCredit = entry.direction == 'CREDIT';
          return ListTile(
            leading: Icon(Icons.diamond, color: isCredit ? CoinTheme.magenta : Colors.grey),
            title: Text(entry.label),
            subtitle: Text(_formatDate(entry.createdAt)),
            trailing: Text('${isCredit ? '+' : '-'}${entry.diamonds}', style: TextStyle(fontWeight: FontWeight.bold, color: isCredit ? CoinTheme.magenta : Colors.grey)),
          );
        },
      ),
    );
  }
}

class _EarningsHistoryTab extends ConsumerStatefulWidget {
  const _EarningsHistoryTab();

  @override
  ConsumerState<_EarningsHistoryTab> createState() => _EarningsHistoryTabState();
}

class _EarningsHistoryTabState extends ConsumerState<_EarningsHistoryTab> {
  List<EarningsLedgerEntryModel> _entries = [];
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
      final page = await ref.read(creatorEconomyRepositoryProvider).fetchEarningsHistory();
      if (mounted) setState(() => _entries = page.entries);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return AppErrorWidget(message: _error!, onRetry: _load);
    if (_entries.isEmpty) return const Center(child: Text('No earnings activity yet.'));

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: _entries.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final entry = _entries[index];
          final isCredit = entry.direction == 'CREDIT';
          return ListTile(
            leading: Icon(Icons.receipt_long_outlined, color: isCredit ? Colors.green : Colors.redAccent),
            title: Text(entry.label),
            subtitle: Text(_formatDate(entry.createdAt)),
            trailing: Text(entry.formattedAmount, style: TextStyle(fontWeight: FontWeight.bold, color: isCredit ? Colors.green : Colors.redAccent)),
          );
        },
      ),
    );
  }
}

String _formatDate(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} '
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}
