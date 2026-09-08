import '../../../core/network/api_client.dart';
import '../domain/coin_models.dart';

/// Coins — balance, packages, purchase, and the two distinct history views
/// the backend exposes: `/coins/history` ("Coin History" — every
/// balance-affecting ledger event) and `/coins/purchases` ("Transaction
/// History" — real-money purchases only). Every price/Coin-amount value
/// comes straight from the backend; nothing here recomputes pricing.
class CoinsRepository {
  const CoinsRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<CoinBalance> fetchBalance() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/coins/balance');
    return CoinBalance.fromJson(response.data!);
  }

  Future<int?> setDailyGiftLimit(int? dailyGiftLimitCoins) async {
    final response = await _apiClient.patch<Map<String, dynamic>>(
      '/coins/wallet/daily-limit',
      data: {'dailyGiftLimitCoins': dailyGiftLimitCoins},
    );
    return response.data!['dailyGiftLimitCoins'] as int?;
  }

  Future<List<CoinPackageModel>> fetchPackages() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/coins/packages');
    return (response.data!['packages'] as List)
        .map((item) => CoinPackageModel.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<({List<CoinLedgerEntryModel> entries, String? nextCursor})> fetchHistory({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/coins/history',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      entries: (data['history'] as List).map((item) => CoinLedgerEntryModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<({List<CoinPurchaseModel> purchases, String? nextCursor})> fetchPurchases({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/coins/purchases',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      purchases: (data['purchases'] as List).map((item) => CoinPurchaseModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  /// Step 1 of the purchase flow — creates a CREATED purchase with its own
  /// permanent pricing snapshot. No Coins are credited yet.
  Future<String> createPurchase({
    required String packageId,
    required String provider,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/coins/purchases',
      data: {'packageId': packageId, 'provider': provider, 'idempotencyKey': idempotencyKey},
    );
    return response.data!['purchaseId'] as String;
  }

  /// Step 2 — submits the provider receipt for verification. Only on
  /// genuine verification success does the backend credit Coins; never
  /// trust a client-reported "payment succeeded" flag (see
  /// `lib/paymentProviders.ts`).
  Future<({String status, int coinAmount, int balance})> verifyPurchase({
    required String purchaseId,
    required String receipt,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/coins/purchases/$purchaseId/verify',
      data: {'receipt': receipt},
    );
    final data = response.data!;
    return (status: data['status'] as String, coinAmount: data['coinAmount'] as int, balance: data['balance'] as int);
  }
}
