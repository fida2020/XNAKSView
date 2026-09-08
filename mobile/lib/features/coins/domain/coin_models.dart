import 'package:equatable/equatable.dart';

/// The signed-in user's Coin wallet — [balance] and [dailyGiftLimitCoins]
/// are both server-authoritative; the client never computes or overrides
/// either (see backend `lib/coinLedger.ts` / `CoinWallet`).
class CoinBalance extends Equatable {
  const CoinBalance({required this.balance, this.dailyGiftLimitCoins});

  factory CoinBalance.fromJson(Map<String, dynamic> json) {
    return CoinBalance(
      balance: json['balance'] as int,
      dailyGiftLimitCoins: json['dailyGiftLimitCoins'] as int?,
    );
  }

  final int balance;
  final int? dailyGiftLimitCoins;

  @override
  List<Object?> get props => [balance, dailyGiftLimitCoins];
}

/// A purchasable Coin package. Every priced field here is computed by the
/// backend from the locked 1 Coin = PKR 1.50 rate and the current PKR/USD
/// exchange rate (see `lib/coinEconomy.ts`) — this model only displays what
/// the server sent, it never recomputes `coinAmount` locally.
class CoinPackageModel extends Equatable {
  const CoinPackageModel({
    required this.id,
    required this.baseUsdPrice,
    required this.taxUsd,
    required this.feeUsd,
    required this.totalUsdPrice,
    required this.exchangeRatePkrPerUsd,
    required this.coinValuePkr,
    required this.coinAmount,
    required this.active,
    required this.sortOrder,
  });

  factory CoinPackageModel.fromJson(Map<String, dynamic> json) {
    return CoinPackageModel(
      id: json['id'] as String,
      baseUsdPrice: json['baseUsdPrice'] as String,
      taxUsd: json['taxUsd'] as String,
      feeUsd: json['feeUsd'] as String,
      totalUsdPrice: json['totalUsdPrice'] as String,
      exchangeRatePkrPerUsd: json['exchangeRatePkrPerUsd'] as String,
      coinValuePkr: json['coinValuePkr'] as String,
      coinAmount: json['coinAmount'] as int,
      active: json['active'] as bool,
      sortOrder: json['sortOrder'] as int,
    );
  }

  final String id;
  // Decimal amounts arrive as strings (see backend's `.toFixed()`
  // serialization) — never parsed into a `double` here, since that would
  // reintroduce float rounding on values the server already computed
  // precisely. They are display-only; formatting is a plain string op.
  final String baseUsdPrice;
  final String taxUsd;
  final String feeUsd;
  final String totalUsdPrice;
  final String exchangeRatePkrPerUsd;
  final String coinValuePkr;
  final int coinAmount;
  final bool active;
  final int sortOrder;

  @override
  List<Object?> get props => [id, baseUsdPrice, totalUsdPrice, coinAmount, active, sortOrder];
}

enum CoinLedgerDirection { credit, debit, unknown }

CoinLedgerDirection _directionFromApi(String value) {
  switch (value) {
    case 'CREDIT':
      return CoinLedgerDirection.credit;
    case 'DEBIT':
      return CoinLedgerDirection.debit;
    default:
      return CoinLedgerDirection.unknown;
  }
}

/// One row of "Coin History" — every balance-affecting event (purchases
/// credited, Gifts spent, refunds, adjustments), distinct from "Transaction
/// History" (`CoinPurchaseModel`, real-money purchases only).
class CoinLedgerEntryModel extends Equatable {
  const CoinLedgerEntryModel({
    required this.id,
    required this.direction,
    required this.type,
    required this.amount,
    required this.beforeBalance,
    required this.afterBalance,
    this.referenceType,
    this.referenceId,
    required this.createdAt,
  });

  factory CoinLedgerEntryModel.fromJson(Map<String, dynamic> json) {
    return CoinLedgerEntryModel(
      id: json['id'] as String,
      direction: _directionFromApi(json['direction'] as String),
      type: json['type'] as String,
      amount: json['amount'] as int,
      beforeBalance: json['beforeBalance'] as int,
      afterBalance: json['afterBalance'] as int,
      referenceType: json['referenceType'] as String?,
      referenceId: json['referenceId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final CoinLedgerDirection direction;
  final String type;
  final int amount;
  final int beforeBalance;
  final int afterBalance;
  final String? referenceType;
  final String? referenceId;
  final DateTime createdAt;

  String get label {
    switch (type) {
      case 'PURCHASE':
        return 'Coins purchased';
      case 'GIFT_SENT':
        return 'Gift sent';
      case 'REFUND':
        return 'Refund';
      case 'ADJUSTMENT':
        return 'Adjustment';
      default:
        return type;
    }
  }

  @override
  List<Object?> get props => [id, direction, type, amount, createdAt];
}

enum CoinPurchaseStatus { created, pending, paid, coinsCredited, failed, cancelled, refunded, chargeback, unknown }

CoinPurchaseStatus _purchaseStatusFromApi(String value) {
  switch (value) {
    case 'CREATED':
      return CoinPurchaseStatus.created;
    case 'PENDING':
      return CoinPurchaseStatus.pending;
    case 'PAID':
      return CoinPurchaseStatus.paid;
    case 'COINS_CREDITED':
      return CoinPurchaseStatus.coinsCredited;
    case 'FAILED':
      return CoinPurchaseStatus.failed;
    case 'CANCELLED':
      return CoinPurchaseStatus.cancelled;
    case 'REFUNDED':
      return CoinPurchaseStatus.refunded;
    case 'CHARGEBACK':
      return CoinPurchaseStatus.chargeback;
    default:
      return CoinPurchaseStatus.unknown;
  }
}

/// "Transaction History" — a real-money purchase attempt, with the
/// permanent pricing snapshot the backend froze at creation time (never
/// affected by a later PKR/USD rate change — see `CoinPurchase`'s schema
/// comment).
class CoinPurchaseModel extends Equatable {
  const CoinPurchaseModel({
    required this.id,
    required this.totalUsdPrice,
    required this.coinAmount,
    required this.provider,
    required this.status,
    required this.createdAt,
  });

  factory CoinPurchaseModel.fromJson(Map<String, dynamic> json) {
    return CoinPurchaseModel(
      id: json['id'] as String,
      totalUsdPrice: json['totalUsdPrice'] as String,
      coinAmount: json['coinAmount'] as int,
      provider: json['provider'] as String,
      status: _purchaseStatusFromApi(json['status'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String totalUsdPrice;
  final int coinAmount;
  final String provider;
  final CoinPurchaseStatus status;
  final DateTime createdAt;

  String get statusLabel {
    switch (status) {
      case CoinPurchaseStatus.created:
      case CoinPurchaseStatus.pending:
        return 'Pending';
      case CoinPurchaseStatus.paid:
        return 'Processing';
      case CoinPurchaseStatus.coinsCredited:
        return 'Completed';
      case CoinPurchaseStatus.failed:
        return 'Failed';
      case CoinPurchaseStatus.cancelled:
        return 'Cancelled';
      case CoinPurchaseStatus.refunded:
        return 'Refunded';
      case CoinPurchaseStatus.chargeback:
        return 'Chargeback';
      case CoinPurchaseStatus.unknown:
        return 'Unknown';
    }
  }

  @override
  List<Object?> get props => [id, totalUsdPrice, coinAmount, provider, status, createdAt];
}
