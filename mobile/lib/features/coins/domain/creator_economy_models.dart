import 'package:equatable/equatable.dart';

/// A creator's Diamond balance — Diamonds are never purchasable, sendable,
/// or client-convertible (see backend `CreatorDiamondWallet`'s schema
/// comment); this is a read-only reflection of server state.
class DiamondBalance extends Equatable {
  const DiamondBalance({required this.balance});

  factory DiamondBalance.fromJson(Map<String, dynamic> json) => DiamondBalance(balance: json['balance'] as int);

  final int balance;

  @override
  List<Object?> get props => [balance];
}

class DiamondLedgerEntryModel extends Equatable {
  const DiamondLedgerEntryModel({
    required this.id,
    required this.direction,
    required this.sourceType,
    required this.diamonds,
    required this.createdAt,
  });

  factory DiamondLedgerEntryModel.fromJson(Map<String, dynamic> json) {
    return DiamondLedgerEntryModel(
      id: json['id'] as String,
      direction: json['direction'] as String,
      sourceType: json['sourceType'] as String,
      diamonds: json['diamonds'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String direction;
  final String sourceType;
  final int diamonds;
  final DateTime createdAt;

  String get label {
    switch (sourceType) {
      case 'LIVE_GIFT':
        return 'LIVE Gift received';
      case 'VIDEO_GIFT':
        return 'Video Gift received';
      case 'ADJUSTMENT':
        return direction == 'CREDIT' ? 'Adjustment' : 'Converted to earnings';
      default:
        return sourceType;
    }
  }

  @override
  List<Object?> get props => [id, direction, sourceType, diamonds, createdAt];
}

/// A creator's cash-equivalent earnings balance, in integer minor units
/// (e.g. cents) of [currency] — a completely separate wallet from Diamonds
/// (see backend `CreatorEarningsWallet`'s schema comment: "keep Diamond
/// balance and Cash/Reward earnings balance SEPARATE, never mixed").
class EarningsBalance extends Equatable {
  const EarningsBalance({required this.balanceMinorUnits, required this.currency});

  factory EarningsBalance.fromJson(Map<String, dynamic> json) {
    return EarningsBalance(balanceMinorUnits: json['balanceMinorUnits'] as int, currency: json['currency'] as String);
  }

  final int balanceMinorUnits;
  final String currency;

  String get formatted => '${(balanceMinorUnits / 100).toStringAsFixed(2)} $currency';

  @override
  List<Object?> get props => [balanceMinorUnits, currency];
}

class EarningsLedgerEntryModel extends Equatable {
  const EarningsLedgerEntryModel({
    required this.id,
    required this.direction,
    required this.type,
    required this.amountMinorUnits,
    required this.currency,
    required this.createdAt,
  });

  factory EarningsLedgerEntryModel.fromJson(Map<String, dynamic> json) {
    return EarningsLedgerEntryModel(
      id: json['id'] as String,
      direction: json['direction'] as String,
      type: json['type'] as String,
      amountMinorUnits: json['amountMinorUnits'] as int,
      currency: json['currency'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String direction;
  final String type;
  final int amountMinorUnits;
  final String currency;
  final DateTime createdAt;

  String get label {
    switch (type) {
      case 'DIAMOND_REWARD':
        return 'Diamonds converted to earnings';
      case 'WITHDRAWAL_HOLD':
        return 'Withdrawal requested';
      case 'WITHDRAWAL_REVERSAL':
        return 'Withdrawal reversed';
      case 'ADJUSTMENT':
        return 'Adjustment';
      default:
        return type;
    }
  }

  String get formattedAmount => '${direction == 'CREDIT' ? '+' : '-'}${(amountMinorUnits / 100).toStringAsFixed(2)} $currency';

  @override
  List<Object?> get props => [id, direction, type, amountMinorUnits, createdAt];
}

/// A country the creator can pick when adding a bank account — the only
/// two fields ever exposed to the client (limits/fees/provider routing stay
/// server-side, see `GET /creator/payout-method/countries`'s doc comment).
class PayoutCountryOption extends Equatable {
  const PayoutCountryOption({required this.countryCode, required this.currency});

  factory PayoutCountryOption.fromJson(Map<String, dynamic> json) {
    return PayoutCountryOption(countryCode: json['countryCode'] as String, currency: json['currency'] as String);
  }

  final String countryCode;
  final String currency;

  @override
  List<Object?> get props => [countryCode, currency];
}

/// One dynamic bank-detail field for the creator's country — never a
/// hardcoded IBAN/SWIFT/sort-code shape on the client; the field list comes
/// entirely from `GET /creator/payout-method/schema`.
class BankFieldModel extends Equatable {
  const BankFieldModel({required this.key, required this.label, required this.type, required this.required});

  factory BankFieldModel.fromJson(Map<String, dynamic> json) {
    return BankFieldModel(key: json['key'] as String, label: json['label'] as String, type: json['type'] as String, required: json['required'] as bool);
  }

  final String key;
  final String label;
  final String type;
  final bool required;

  @override
  List<Object?> get props => [key, label, type, required];
}

enum PayoutMethodStatus { pendingVerification, verified, rejected, disabled, unknown }

PayoutMethodStatus _payoutMethodStatusFromApi(String value) {
  switch (value) {
    case 'PENDING_VERIFICATION':
      return PayoutMethodStatus.pendingVerification;
    case 'VERIFIED':
      return PayoutMethodStatus.verified;
    case 'REJECTED':
      return PayoutMethodStatus.rejected;
    case 'DISABLED':
      return PayoutMethodStatus.disabled;
    default:
      return PayoutMethodStatus.unknown;
  }
}

/// A creator's single bank account (Step 9) — real bank details never live
/// on the client beyond what's needed to show "•••• 4821" back; see backend
/// `CreatorPayoutMethod`'s schema comment.
class PayoutMethodModel extends Equatable {
  const PayoutMethodModel({
    required this.id,
    required this.country,
    required this.currency,
    required this.bankDetailsMasked,
    required this.status,
    this.rejectionReason,
  });

  factory PayoutMethodModel.fromJson(Map<String, dynamic> json) {
    return PayoutMethodModel(
      id: json['id'] as String,
      country: json['country'] as String,
      currency: json['currency'] as String,
      bankDetailsMasked: Map<String, dynamic>.from(json['bankDetailsMasked'] as Map),
      status: _payoutMethodStatusFromApi(json['status'] as String),
      rejectionReason: json['rejectionReason'] as String?,
    );
  }

  final String id;
  final String country;
  final String currency;
  final Map<String, dynamic> bankDetailsMasked;
  final PayoutMethodStatus status;
  final String? rejectionReason;

  bool get isVerified => status == PayoutMethodStatus.verified;

  String get accountHolderName => bankDetailsMasked['accountHolderName'] as String? ?? '';

  /// The first masked account-like value (e.g. "••••4821") for a one-line summary.
  String? get maskedAccountSummary {
    for (final entry in bankDetailsMasked.entries) {
      if (entry.key != 'accountHolderName' && entry.value is String && (entry.value as String).contains('•')) {
        return entry.value as String;
      }
    }
    return null;
  }

  @override
  List<Object?> get props => [id, country, currency, status, rejectionReason];
}

enum IdentityVerificationStatus { pending, approved, rejected, expired, unknown }

IdentityVerificationStatus _identityStatusFromApi(String value) {
  switch (value) {
    case 'PENDING':
      return IdentityVerificationStatus.pending;
    case 'APPROVED':
      return IdentityVerificationStatus.approved;
    case 'REJECTED':
      return IdentityVerificationStatus.rejected;
    case 'EXPIRED':
      return IdentityVerificationStatus.expired;
    default:
      return IdentityVerificationStatus.unknown;
  }
}

/// Automatic identity verification (KYC) — kept separate from the payout
/// method (see backend `routes/v1/identityVerification.ts`'s doc comment).
class IdentityVerificationModel extends Equatable {
  const IdentityVerificationModel({required this.id, required this.status, this.hostedUrl, this.rejectionReason});

  factory IdentityVerificationModel.fromJson(Map<String, dynamic> json) {
    return IdentityVerificationModel(
      id: json['id'] as String,
      status: _identityStatusFromApi(json['status'] as String),
      hostedUrl: json['hostedUrl'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
    );
  }

  final String id;
  final IdentityVerificationStatus status;
  final String? hostedUrl;
  final String? rejectionReason;

  bool get isApproved => status == IdentityVerificationStatus.approved;

  @override
  List<Object?> get props => [id, status, hostedUrl, rejectionReason];
}

/// Fee/FX/net preview shown BEFORE submission — the server always
/// recalculates this again for real at confirmation time; the client never
/// decides the final payout amount.
class WithdrawalPreviewModel extends Equatable {
  const WithdrawalPreviewModel({
    required this.amountMinorUnits,
    required this.currency,
    required this.feeMinorUnits,
    required this.netAmountMinorUnits,
    required this.estimatedProcessingDays,
    required this.countryCode,
  });

  factory WithdrawalPreviewModel.fromJson(Map<String, dynamic> json) {
    return WithdrawalPreviewModel(
      amountMinorUnits: json['amountMinorUnits'] as int,
      currency: json['currency'] as String,
      feeMinorUnits: json['feeMinorUnits'] as int,
      netAmountMinorUnits: json['netAmountMinorUnits'] as int,
      estimatedProcessingDays: json['estimatedProcessingDays'] as int,
      countryCode: json['countryCode'] as String,
    );
  }

  final int amountMinorUnits;
  final String currency;
  final int feeMinorUnits;
  final int netAmountMinorUnits;
  final int estimatedProcessingDays;
  final String countryCode;

  String get formattedAmount => '${(amountMinorUnits / 100).toStringAsFixed(2)} $currency';
  String get formattedFee => '${(feeMinorUnits / 100).toStringAsFixed(2)} $currency';
  String get formattedNet => '${(netAmountMinorUnits / 100).toStringAsFixed(2)} $currency';

  @override
  List<Object?> get props => [amountMinorUnits, currency, feeMinorUnits, netAmountMinorUnits, estimatedProcessingDays, countryCode];
}

enum WithdrawalStatus {
  requested,
  reviewing,
  approved,
  processing,
  paid,
  rejected,
  failed,
  cancelled,
  unknown,
}

WithdrawalStatus _statusFromApi(String value) {
  switch (value) {
    case 'REQUESTED':
      return WithdrawalStatus.requested;
    case 'REVIEWING':
      return WithdrawalStatus.reviewing;
    case 'APPROVED':
      return WithdrawalStatus.approved;
    case 'PROCESSING':
      return WithdrawalStatus.processing;
    case 'PAID':
      return WithdrawalStatus.paid;
    case 'REJECTED':
      return WithdrawalStatus.rejected;
    case 'FAILED':
      return WithdrawalStatus.failed;
    case 'CANCELLED':
      return WithdrawalStatus.cancelled;
    default:
      return WithdrawalStatus.unknown;
  }
}

/// A withdrawal driven end-to-end by the Step 9 automatic pipeline — real
/// country routing, KYC, fraud checks, provider submission, and webhook
/// confirmation, never a fake/optimistic PAID (see backend
/// `lib/withdrawalOrchestrator.ts`'s doc comment).
class WithdrawalModel extends Equatable {
  const WithdrawalModel({
    required this.id,
    required this.amountMinorUnits,
    required this.currency,
    required this.status,
    this.feeMinorUnits,
    this.netAmountMinorUnits,
    this.rejectionReason,
    this.failureReason,
    required this.createdAt,
    this.processedAt,
  });

  factory WithdrawalModel.fromJson(Map<String, dynamic> json) {
    return WithdrawalModel(
      id: json['id'] as String,
      amountMinorUnits: json['amountMinorUnits'] as int,
      currency: json['currency'] as String,
      status: _statusFromApi(json['status'] as String),
      feeMinorUnits: json['feeMinorUnits'] as int?,
      netAmountMinorUnits: json['netAmountMinorUnits'] as int?,
      rejectionReason: json['rejectionReason'] as String?,
      failureReason: json['failureReason'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      processedAt: json['processedAt'] == null ? null : DateTime.parse(json['processedAt'] as String),
    );
  }

  final String id;
  final int amountMinorUnits;
  final String currency;
  final WithdrawalStatus status;
  final int? feeMinorUnits;
  final int? netAmountMinorUnits;
  final String? rejectionReason;
  final String? failureReason;
  final DateTime createdAt;
  final DateTime? processedAt;

  String get formattedAmount => '${(amountMinorUnits / 100).toStringAsFixed(2)} $currency';

  String get statusLabel {
    switch (status) {
      case WithdrawalStatus.requested:
        return 'Requested';
      case WithdrawalStatus.reviewing:
        return 'Under review';
      case WithdrawalStatus.approved:
        return 'Approved';
      case WithdrawalStatus.processing:
        return 'Processing';
      case WithdrawalStatus.paid:
        return 'Paid';
      case WithdrawalStatus.rejected:
        return 'Rejected';
      case WithdrawalStatus.failed:
        return 'Failed';
      case WithdrawalStatus.cancelled:
        return 'Cancelled';
      case WithdrawalStatus.unknown:
        return 'Unknown';
    }
  }

  bool get isCancellable => status == WithdrawalStatus.requested;

  @override
  List<Object?> get props => [id, amountMinorUnits, currency, status, createdAt];
}
