import 'package:equatable/equatable.dart';

/// Mirrors the backend's `MonetizationStatus` enum exactly — server-computed,
/// the mobile client never decides this itself.
enum MonetizationStatus { notEligible, eligible, pendingReview, active, suspended, disabled, unknown }

MonetizationStatus monetizationStatusFromApi(String value) {
  switch (value) {
    case 'NOT_ELIGIBLE':
      return MonetizationStatus.notEligible;
    case 'ELIGIBLE':
      return MonetizationStatus.eligible;
    case 'PENDING_REVIEW':
      return MonetizationStatus.pendingReview;
    case 'ACTIVE':
      return MonetizationStatus.active;
    case 'SUSPENDED':
      return MonetizationStatus.suspended;
    case 'DISABLED':
      return MonetizationStatus.disabled;
    default:
      return MonetizationStatus.unknown;
  }
}

extension MonetizationStatusLabel on MonetizationStatus {
  String get label => switch (this) {
        MonetizationStatus.notEligible => 'Not eligible yet',
        MonetizationStatus.eligible => 'Eligible — pending activation',
        MonetizationStatus.pendingReview => 'Under review',
        MonetizationStatus.active => 'Active',
        MonetizationStatus.suspended => 'Suspended',
        MonetizationStatus.disabled => 'Disabled',
        MonetizationStatus.unknown => 'Unknown',
      };
}

class EligibilityRequirementModel extends Equatable {
  const EligibilityRequirementModel({required this.key, required this.label, required this.required, required this.current, required this.met});

  factory EligibilityRequirementModel.fromJson(Map<String, dynamic> json) {
    return EligibilityRequirementModel(
      key: json['key'] as String,
      label: json['label'] as String,
      required: json['required'],
      current: json['current'],
      met: json['met'] as bool,
    );
  }

  final String key;
  final String label;
  final Object? required;
  final Object? current;
  final bool met;

  @override
  List<Object?> get props => [key, label, required, current, met];
}

class MonetizationStatusModel extends Equatable {
  const MonetizationStatusModel({
    required this.status,
    required this.activatedAt,
    required this.statusReason,
    required this.eligible,
    required this.requirements,
    required this.creatorSharePercent,
  });

  factory MonetizationStatusModel.fromJson(Map<String, dynamic> json) {
    return MonetizationStatusModel(
      status: monetizationStatusFromApi(json['status'] as String),
      activatedAt: json['activatedAt'] != null ? DateTime.parse(json['activatedAt'] as String) : null,
      statusReason: json['statusReason'] as String?,
      eligible: json['eligible'] as bool,
      requirements: (json['requirements'] as List).map((item) => EligibilityRequirementModel.fromJson(item as Map<String, dynamic>)).toList(),
      creatorSharePercent: json['creatorSharePercent'] as String,
    );
  }

  final MonetizationStatus status;
  final DateTime? activatedAt;
  final String? statusReason;
  final bool eligible;
  final List<EligibilityRequirementModel> requirements;
  final String creatorSharePercent;

  @override
  List<Object?> get props => [status, activatedAt, statusReason, eligible, requirements, creatorSharePercent];
}

class AdRevenueEventModel extends Equatable {
  const AdRevenueEventModel({
    required this.id,
    required this.type,
    required this.provider,
    required this.videoId,
    required this.grossRevenueMinorUnits,
    required this.currency,
    required this.status,
    required this.wasMonetizationActive,
    required this.creatorShareMinorUnits,
    required this.platformShareMinorUnits,
    required this.createdAt,
  });

  factory AdRevenueEventModel.fromJson(Map<String, dynamic> json) {
    return AdRevenueEventModel(
      id: json['id'] as String,
      type: json['type'] as String,
      provider: json['provider'] as String,
      videoId: json['videoId'] as String,
      grossRevenueMinorUnits: json['grossRevenueMinorUnits'] as int,
      currency: json['currency'] as String,
      status: json['status'] as String,
      wasMonetizationActive: json['wasMonetizationActive'] as bool,
      creatorShareMinorUnits: json['creatorShareMinorUnits'] as int,
      platformShareMinorUnits: json['platformShareMinorUnits'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String type;
  final String provider;
  final String videoId;
  final int grossRevenueMinorUnits;
  final String currency;
  final String status;
  final bool wasMonetizationActive;
  final int creatorShareMinorUnits;
  final int platformShareMinorUnits;
  final DateTime createdAt;

  bool get isReversal => type == 'REVERSAL';

  @override
  List<Object?> get props => [id, type, provider, videoId, grossRevenueMinorUnits, currency, status, wasMonetizationActive, creatorShareMinorUnits, platformShareMinorUnits, createdAt];
}
