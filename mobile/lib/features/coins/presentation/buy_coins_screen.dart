import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../../../core/widgets/xnak_coin_icon.dart';
import '../data/payment_receipt_provider.dart';
import '../domain/coin_models.dart';
import 'coin_theme.dart';
import 'coins_providers.dart';

/// Buy Coins (brief §2) — package selection is real (backend-priced,
/// nothing hardcoded here), purchase creation is real, and verification
/// goes through the real backend `/coins/purchases/:id/verify` endpoint.
/// What's honest rather than faked: obtaining an actual payment receipt.
/// See `payment_receipt_provider.dart` for exactly why none of the three
/// providers can produce one in this build/environment yet — the UI
/// reflects that truthfully instead of pretending a payment succeeded.
class BuyCoinsScreen extends ConsumerStatefulWidget {
  const BuyCoinsScreen({super.key});

  @override
  ConsumerState<BuyCoinsScreen> createState() => _BuyCoinsScreenState();
}

enum _PaymentProviderOption { appStore, googlePlay, web }

extension on _PaymentProviderOption {
  String get apiValue => switch (this) {
        _PaymentProviderOption.appStore => 'APP_STORE',
        _PaymentProviderOption.googlePlay => 'GOOGLE_PLAY',
        _PaymentProviderOption.web => 'WEB',
      };

  String get label => switch (this) {
        _PaymentProviderOption.appStore => 'Apple App Store',
        _PaymentProviderOption.googlePlay => 'Google Play',
        _PaymentProviderOption.web => 'Web payment',
      };

  IconData get icon => switch (this) {
        _PaymentProviderOption.appStore => Icons.apple,
        _PaymentProviderOption.googlePlay => Icons.shop,
        _PaymentProviderOption.web => Icons.language,
      };
}

class _BuyCoinsScreenState extends ConsumerState<BuyCoinsScreen> {
  List<CoinPackageModel> _packages = [];
  bool _isLoading = true;
  String? _error;
  CoinPackageModel? _selectedPackage;
  bool _isPurchasing = false;

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
      final packages = await ref.read(coinsRepositoryProvider).fetchPackages();
      if (mounted) {
        setState(() {
          _packages = packages;
          _selectedPackage = packages.isNotEmpty ? packages.first : null;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _purchase(_PaymentProviderOption providerOption) async {
    final package = _selectedPackage;
    if (package == null || _isPurchasing) return;

    setState(() => _isPurchasing = true);
    final coinsRepository = ref.read(coinsRepositoryProvider);
    final idempotencyKey = 'buy-${package.id}-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

    try {
      final purchaseId = await coinsRepository.createPurchase(
        packageId: package.id,
        provider: providerOption.apiValue,
        idempotencyKey: idempotencyKey,
      );

      final receiptProvider = switch (providerOption) {
        _PaymentProviderOption.appStore => ref.read(appStoreReceiptProviderProvider),
        _PaymentProviderOption.googlePlay => ref.read(googlePlayReceiptProviderProvider),
        _PaymentProviderOption.web => ref.read(webPaymentReceiptProviderProvider),
      };

      final totalCents = (double.parse(package.totalUsdPrice) * 100).round();
      final receipt = await receiptProvider.obtainReceipt(purchaseId: purchaseId, totalUsdCents: totalCents);

      final result = await coinsRepository.verifyPurchase(purchaseId: purchaseId, receipt: receipt);
      if (!mounted) return;

      ref.read(coinBalanceProvider.notifier).applyKnownBalance(result.balance);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Purchase complete'),
          content: Text('${result.coinAmount} Coins were added to your balance.'),
          actions: [FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done'))],
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } on PaymentNotAvailableException catch (error) {
      if (mounted) _showError(error.message);
    } on AppException catch (error) {
      if (mounted) _showError(error.message);
    } finally {
      if (mounted) setState(() => _isPurchasing = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  void _choosePaymentMethod() {
    if (_selectedPackage == null) return;
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Choose a payment method', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            for (final option in _PaymentProviderOption.values)
              ListTile(
                leading: Icon(option.icon),
                title: Text(option.label),
                onTap: () {
                  Navigator.of(context).pop();
                  _purchase(option);
                },
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Buy Coins')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? AppErrorWidget(message: _error!, onRetry: _load)
              : _packages.isEmpty
                  ? const Center(child: Text('No Coin packages are available right now.'))
                  : _buildBody(),
      bottomNavigationBar: _packages.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _isPurchasing || _selectedPackage == null ? null : _choosePaymentMethod,
                    child: _isPurchasing
                        ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(_selectedPackage == null ? 'Select a package' : 'Buy for \$${_selectedPackage!.totalUsdPrice}'),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _buildBody() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _packages.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final package = _packages[index];
          final selected = _selectedPackage?.id == package.id;
          return _PackageCard(
            package: package,
            selected: selected,
            onTap: () => setState(() => _selectedPackage = package),
          );
        },
      ),
    );
  }
}

class _PackageCard extends StatelessWidget {
  const _PackageCard({required this.package, required this.selected, required this.onTap});

  final CoinPackageModel package;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? CoinTheme.goldDark : Colors.black12, width: selected ? 2 : 1),
          color: selected ? CoinTheme.gold.withValues(alpha: 0.12) : null,
        ),
        child: Row(
          children: [
            const XnakCoinIcon(size: 36),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${package.coinAmount} Coins', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 2),
                  Text(
                    'Base \$${package.baseUsdPrice}'
                    '${double.parse(package.taxUsd) > 0 ? ' + tax \$${package.taxUsd}' : ''}'
                    '${double.parse(package.feeUsd) > 0 ? ' + fee \$${package.feeUsd}' : ''}',
                    style: const TextStyle(color: Colors.black54, fontSize: 12),
                  ),
                ],
              ),
            ),
            Text('\$${package.totalUsdPrice}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
      ),
    );
  }
}
