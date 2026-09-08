import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../../../core/widgets/xnak_coin_icon.dart';
import '../domain/coin_models.dart';
import 'buy_coins_screen.dart';
import 'coins_providers.dart';
import 'daily_gift_limit_sheet.dart';

/// The Coin wallet — balance, Buy Coins entry point, and the two distinct
/// history views the backend exposes (brief §1): "Coin History" (every
/// balance-affecting ledger event) and "Purchase/Transaction History"
/// (real-money purchases only). Every number shown here is exactly what the
/// backend returned; nothing is computed client-side.
class CoinWalletScreen extends ConsumerStatefulWidget {
  const CoinWalletScreen({super.key});

  @override
  ConsumerState<CoinWalletScreen> createState() => _CoinWalletScreenState();
}

class _CoinWalletScreenState extends ConsumerState<CoinWalletScreen> with SingleTickerProviderStateMixin {
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
    final balanceAsync = ref.watch(coinBalanceProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Coins'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Daily Gift limit',
            onPressed: () => showDailyGiftLimitSheet(context, ref),
          ),
        ],
      ),
      body: Column(
        children: [
          _BalanceCard(balanceAsync: balanceAsync),
          const SizedBox(height: 8),
          TabBar(
            controller: _tabController,
            tabs: const [Tab(text: 'Coin History'), Tab(text: 'Purchases')],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: const [_CoinHistoryTab(), _PurchaseHistoryTab()],
            ),
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends ConsumerWidget {
  const _BalanceCard({required this.balanceAsync});

  final AsyncValue<int> balanceAsync;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFFEEEEEE),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 16, offset: const Offset(0, 6))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Your balance', style: TextStyle(color: Colors.black54, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Row(
              children: [
                const XnakCoinIcon(size: 30),
                const SizedBox(width: 8),
                balanceAsync.when(
                  data: (balance) => Text(
                    '$balance',
                    style: const TextStyle(color: Colors.black87, fontSize: 32, fontWeight: FontWeight.bold),
                  ),
                  loading: () => const SizedBox(
                    height: 32,
                    width: 32,
                    child: CircularProgressIndicator(strokeWidth: 3, color: Colors.black54),
                  ),
                  error: (error, _) => const Text('—', style: TextStyle(color: Colors.black87, fontSize: 32)),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: Colors.black87, foregroundColor: Colors.white),
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BuyCoinsScreen())),
                icon: const Icon(Icons.add_circle_outline),
                label: const Text('Buy Coins'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CoinHistoryTab extends ConsumerStatefulWidget {
  const _CoinHistoryTab();

  @override
  ConsumerState<_CoinHistoryTab> createState() => _CoinHistoryTabState();
}

class _CoinHistoryTabState extends ConsumerState<_CoinHistoryTab> {
  final List<CoinLedgerEntryModel> _entries = [];
  String? _cursor;
  bool _isLoading = true;
  bool _isLoadingMore = false;
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
      final page = await ref.read(coinsRepositoryProvider).fetchHistory();
      if (mounted) {
        setState(() {
          _entries
            ..clear()
            ..addAll(page.entries);
          _cursor = page.nextCursor;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_cursor == null || _isLoadingMore) return;
    setState(() => _isLoadingMore = true);
    try {
      final page = await ref.read(coinsRepositoryProvider).fetchHistory(cursor: _cursor);
      if (mounted) {
        setState(() {
          _entries.addAll(page.entries);
          _cursor = page.nextCursor;
        });
      }
    } on AppException {
      // Best-effort — a failed "load more" shouldn't disturb what's shown.
    } finally {
      if (mounted) setState(() => _isLoadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return AppErrorWidget(message: _error!, onRetry: _load);
    if (_entries.isEmpty) return const Center(child: Text('No Coin activity yet.'));

    return RefreshIndicator(
      onRefresh: _load,
      child: NotificationListener<ScrollEndNotification>(
        onNotification: (notification) {
          if (notification.metrics.extentAfter < 200) _loadMore();
          return false;
        },
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: _entries.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final entry = _entries[index];
            final isCredit = entry.direction == CoinLedgerDirection.credit;
            return ListTile(
              leading: Icon(
                isCredit ? Icons.add_circle_outline : Icons.remove_circle_outline,
                color: isCredit ? Colors.green : Colors.redAccent,
              ),
              title: Text(entry.label),
              subtitle: Text(_formatDate(entry.createdAt)),
              trailing: Text(
                '${isCredit ? '+' : '-'}${entry.amount}',
                style: TextStyle(fontWeight: FontWeight.bold, color: isCredit ? Colors.green : Colors.redAccent),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _PurchaseHistoryTab extends ConsumerStatefulWidget {
  const _PurchaseHistoryTab();

  @override
  ConsumerState<_PurchaseHistoryTab> createState() => _PurchaseHistoryTabState();
}

class _PurchaseHistoryTabState extends ConsumerState<_PurchaseHistoryTab> {
  final List<CoinPurchaseModel> _purchases = [];
  String? _cursor;
  bool _isLoading = true;
  bool _isLoadingMore = false;
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
      final page = await ref.read(coinsRepositoryProvider).fetchPurchases();
      if (mounted) {
        setState(() {
          _purchases
            ..clear()
            ..addAll(page.purchases);
          _cursor = page.nextCursor;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_cursor == null || _isLoadingMore) return;
    setState(() => _isLoadingMore = true);
    try {
      final page = await ref.read(coinsRepositoryProvider).fetchPurchases(cursor: _cursor);
      if (mounted) {
        setState(() {
          _purchases.addAll(page.purchases);
          _cursor = page.nextCursor;
        });
      }
    } on AppException {
      // Best-effort — a failed "load more" shouldn't disturb what's shown.
    } finally {
      if (mounted) setState(() => _isLoadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return AppErrorWidget(message: _error!, onRetry: _load);
    if (_purchases.isEmpty) return const Center(child: Text('No purchases yet.'));

    return RefreshIndicator(
      onRefresh: _load,
      child: NotificationListener<ScrollEndNotification>(
        onNotification: (notification) {
          if (notification.metrics.extentAfter < 200) _loadMore();
          return false;
        },
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: _purchases.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final purchase = _purchases[index];
            return ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text('${purchase.coinAmount} Coins — \$${purchase.totalUsdPrice}'),
              subtitle: Text('${purchase.provider} · ${_formatDate(purchase.createdAt)}'),
              trailing: Chip(label: Text(purchase.statusLabel)),
            );
          },
        ),
      ),
    );
  }
}

String _formatDate(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} '
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}
