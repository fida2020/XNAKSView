import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/coins_repository.dart';
import '../data/creator_economy_repository.dart';
import '../data/gifts_repository.dart';
import '../data/monetization_repository.dart';
import '../data/payment_receipt_provider.dart';

final coinsRepositoryProvider = Provider<CoinsRepository>((ref) {
  return CoinsRepository(ref.watch(apiClientProvider));
});

final giftsRepositoryProvider = Provider<GiftsRepository>((ref) {
  return GiftsRepository(ref.watch(apiClientProvider));
});

final creatorEconomyRepositoryProvider = Provider<CreatorEconomyRepository>((ref) {
  return CreatorEconomyRepository(ref.watch(apiClientProvider));
});

final monetizationRepositoryProvider = Provider<MonetizationRepository>((ref) {
  return MonetizationRepository(ref.watch(apiClientProvider));
});

final appStoreReceiptProviderProvider = Provider<PaymentReceiptProvider>((ref) => const AppStoreReceiptProvider());
final googlePlayReceiptProviderProvider = Provider<PaymentReceiptProvider>((ref) => const GooglePlayReceiptProvider());
final webPaymentReceiptProviderProvider = Provider<PaymentReceiptProvider>((ref) => const WebPaymentReceiptProvider());

/// A live-refreshable Coin balance shared across every screen that shows
/// it (wallet, Gift picker, video action rail) — `refresh()` after any
/// action that can change it (a completed purchase, a sent Gift) so every
/// consumer updates together instead of each screen polling independently.
final coinBalanceProvider = AsyncNotifierProvider<CoinBalanceNotifier, int>(CoinBalanceNotifier.new);

class CoinBalanceNotifier extends AsyncNotifier<int> {
  @override
  Future<int> build() async {
    final balance = await ref.watch(coinsRepositoryProvider).fetchBalance();
    return balance.balance;
  }

  Future<void> refresh() async {
    final balance = await ref.read(coinsRepositoryProvider).fetchBalance();
    state = AsyncData(balance.balance);
  }

  /// Applies a balance the server already told us about (e.g. a
  /// `SendGiftResult.senderBalance` or a purchase-verify response) without
  /// an extra round trip — still server-authoritative, just already in hand.
  void applyKnownBalance(int balance) {
    state = AsyncData(balance);
  }
}
