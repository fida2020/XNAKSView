import '../../../core/network/api_client.dart';
import '../domain/creator_economy_models.dart';

/// Diamonds, Creator Earnings, and Withdrawal — three separate wallets,
/// never collapsed into one balance (see backend §24 comment: "COINS ≠
/// DIAMONDS ≠ CASH"). There is intentionally no method here that converts
/// Diamonds to earnings — that conversion is admin-only server-side
/// (`POST /admin/creators/:id/diamonds/convert`); a creator has no client
/// action that can trigger it.
class CreatorEconomyRepository {
  const CreatorEconomyRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<DiamondBalance> fetchDiamondBalance() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/creator/diamonds');
    return DiamondBalance.fromJson(response.data!);
  }

  Future<({List<DiamondLedgerEntryModel> entries, String? nextCursor})> fetchDiamondHistory({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/diamonds/history',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      entries: (data['history'] as List)
          .map((item) => DiamondLedgerEntryModel.fromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<EarningsBalance> fetchEarningsBalance() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/creator/earnings');
    return EarningsBalance.fromJson(response.data!);
  }

  Future<({List<EarningsLedgerEntryModel> entries, String? nextCursor})> fetchEarningsHistory({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/earnings/history',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      entries: (data['history'] as List)
          .map((item) => EarningsLedgerEntryModel.fromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  /// Countries the creator can pick when adding a bank account — never a
  /// hardcoded list on the client (see `GET /creator/payout-method/countries`'s doc comment).
  Future<List<PayoutCountryOption>> fetchPayoutCountries() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/creator/payout-method/countries');
    return (response.data!['countries'] as List).map((item) => PayoutCountryOption.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<PayoutMethodModel?> fetchPayoutMethod() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/creator/payout-method');
    final raw = response.data!['payoutMethod'];
    return raw == null ? null : PayoutMethodModel.fromJson(raw as Map<String, dynamic>);
  }

  /// Dynamic per-country bank-detail fields — never a hardcoded IBAN/SWIFT/
  /// sort-code shape on the client.
  Future<List<BankFieldModel>> fetchPayoutMethodSchema({required String country, required String currency}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/payout-method/schema',
      queryParameters: {'country': country, 'currency': currency},
    );
    return (response.data!['fields'] as List).map((item) => BankFieldModel.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<({String id, String status, String? rejectionReason})> addPayoutMethod({
    required String country,
    required String currency,
    required String accountHolderName,
    required Map<String, String> bankDetails,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/creator/payout-method',
      data: {'country': country, 'currency': currency, 'accountHolderName': accountHolderName, 'bankDetails': bankDetails},
    );
    final data = response.data!;
    return (id: data['id'] as String, status: data['status'] as String, rejectionReason: data['rejectionReason'] as String?);
  }

  Future<IdentityVerificationModel?> fetchIdentityVerification() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/creator/identity-verification');
    final raw = response.data!['verification'];
    return raw == null ? null : IdentityVerificationModel.fromJson(raw as Map<String, dynamic>);
  }

  Future<IdentityVerificationModel> startIdentityVerification({required String country}) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/creator/identity-verification/start', data: {'country': country});
    return IdentityVerificationModel.fromJson(response.data!);
  }

  /// Fee/FX/net preview BEFORE submission — never persists anything; the
  /// server recalculates this again for real at confirmation time.
  Future<WithdrawalPreviewModel> fetchWithdrawalPreview({required int amountMinorUnits}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/withdrawals/preview',
      queryParameters: {'amountMinorUnits': amountMinorUnits.toString()},
    );
    return WithdrawalPreviewModel.fromJson(response.data!);
  }

  Future<({List<WithdrawalModel> withdrawals, String? nextCursor})> fetchWithdrawals({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/withdrawals',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      withdrawals: (data['withdrawals'] as List)
          .map((item) => WithdrawalModel.fromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  /// No `provider`/destination field — the backend decides which enabled
  /// provider handles the payout from the creator's already-verified bank
  /// account (see `lib/withdrawalOrchestrator.ts`'s doc comment). A creator
  /// never picks a provider.
  Future<({String id, String status, String? rejectionReason, String? failureReason})> requestWithdrawal({
    required int amountMinorUnits,
    required String currency,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/creator/withdrawals',
      data: {'amountMinorUnits': amountMinorUnits, 'currency': currency, 'idempotencyKey': idempotencyKey},
    );
    final data = response.data!;
    return (
      id: data['id'] as String,
      status: data['status'] as String,
      rejectionReason: data['rejectionReason'] as String?,
      failureReason: data['failureReason'] as String?,
    );
  }

  Future<({String id, String status})> cancelWithdrawal(String id) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/creator/withdrawals/$id/cancel');
    final data = response.data!;
    return (id: data['id'] as String, status: data['status'] as String);
  }

  /// Preview-only — never persists anything. `amountMinorUnits` omitted
  /// defaults to the full current Earnings balance. The server recalculates
  /// this again for real at confirmation time; the client never decides
  /// the final Coin amount.
  Future<({int amountMinorUnits, String currency, int coins, String pkrPerUsd, String coinValuePkr})> previewExchangeToCoins({int? amountMinorUnits}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/earnings/exchange-preview',
      queryParameters: {'amountMinorUnits': ?amountMinorUnits?.toString()},
    );
    final data = response.data!;
    return (
      amountMinorUnits: data['amountMinorUnits'] as int,
      currency: data['currency'] as String,
      coins: data['coins'] as int,
      pkrPerUsd: data['pkrPerUsd'] as String,
      coinValuePkr: data['coinValuePkr'] as String,
    );
  }

  /// Earnings → Coins (the creator-chosen alternative to Withdraw). Real,
  /// atomic, idempotent, rate-snapshotted server-side (see
  /// `lib/earningsExchangeService.ts`) — this call never computes the Coin
  /// amount itself, only reports what the server actually did.
  Future<({int coinsCredited, int earningsBalance, int coinBalance})> exchangeToCoins({
    required int amountMinorUnits,
    required String currency,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/creator/earnings/exchange-to-coins',
      data: {'amountMinorUnits': amountMinorUnits, 'currency': currency, 'idempotencyKey': idempotencyKey},
    );
    final data = response.data!;
    return (
      coinsCredited: (data['exchange'] as Map<String, dynamic>)['coinsCredited'] as int,
      earningsBalance: data['earningsBalance'] as int,
      coinBalance: data['coinBalance'] as int,
    );
  }
}
