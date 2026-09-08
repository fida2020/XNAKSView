import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/creator_economy_models.dart';
import 'coins_providers.dart';

/// Live-refreshable creator balances, mirroring `coinBalanceProvider`'s
/// shape — every screen that shows Diamonds/Earnings reads the same value
/// and refreshes together after an admin-driven conversion or a
/// withdrawal action changes it.
final diamondBalanceProvider = AsyncNotifierProvider<DiamondBalanceNotifier, int>(DiamondBalanceNotifier.new);

class DiamondBalanceNotifier extends AsyncNotifier<int> {
  @override
  Future<int> build() async {
    final balance = await ref.watch(creatorEconomyRepositoryProvider).fetchDiamondBalance();
    return balance.balance;
  }

  Future<void> refresh() async {
    final balance = await ref.read(creatorEconomyRepositoryProvider).fetchDiamondBalance();
    state = AsyncData(balance.balance);
  }
}

final earningsBalanceProvider = AsyncNotifierProvider<EarningsBalanceNotifier, ({int balanceMinorUnits, String currency})>(
  EarningsBalanceNotifier.new,
);

class EarningsBalanceNotifier extends AsyncNotifier<({int balanceMinorUnits, String currency})> {
  @override
  Future<({int balanceMinorUnits, String currency})> build() async {
    final balance = await ref.watch(creatorEconomyRepositoryProvider).fetchEarningsBalance();
    return (balanceMinorUnits: balance.balanceMinorUnits, currency: balance.currency);
  }

  Future<void> refresh() async {
    final balance = await ref.read(creatorEconomyRepositoryProvider).fetchEarningsBalance();
    state = AsyncData((balanceMinorUnits: balance.balanceMinorUnits, currency: balance.currency));
  }
}

/// The creator's single bank account (`null` = none added yet) — drives
/// whether the "Withdraw" flow opens straight to Amount or routes through
/// Bank Account/Verification first.
final payoutMethodProvider = AsyncNotifierProvider<PayoutMethodNotifier, PayoutMethodModel?>(PayoutMethodNotifier.new);

class PayoutMethodNotifier extends AsyncNotifier<PayoutMethodModel?> {
  @override
  Future<PayoutMethodModel?> build() => ref.watch(creatorEconomyRepositoryProvider).fetchPayoutMethod();

  Future<void> refresh() async {
    state = AsyncData(await ref.read(creatorEconomyRepositoryProvider).fetchPayoutMethod());
  }
}

final identityVerificationProvider = AsyncNotifierProvider<IdentityVerificationNotifier, IdentityVerificationModel?>(
  IdentityVerificationNotifier.new,
);

class IdentityVerificationNotifier extends AsyncNotifier<IdentityVerificationModel?> {
  @override
  Future<IdentityVerificationModel?> build() => ref.watch(creatorEconomyRepositoryProvider).fetchIdentityVerification();

  Future<void> refresh() async {
    state = AsyncData(await ref.read(creatorEconomyRepositoryProvider).fetchIdentityVerification());
  }
}
