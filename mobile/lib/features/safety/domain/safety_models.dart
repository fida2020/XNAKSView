import 'package:equatable/equatable.dart';

/// TikTok-style Account Status (Step 10) — deliberately does NOT carry any
/// internal fraud score, provider name, or confidence value; the backend
/// never returns them here (see `routes/v1/accountStatus.ts`'s doc
/// comment), so there is nothing for the client to accidentally leak.
enum EnforcementActionType { warn, contentRemoved, limitDistribution, ageRestrict, featureRestrict, temporaryAccountRestrict, permanentBan, unknown }

EnforcementActionType _actionTypeFromApi(String value) {
  switch (value) {
    case 'WARN':
      return EnforcementActionType.warn;
    case 'CONTENT_REMOVED':
      return EnforcementActionType.contentRemoved;
    case 'LIMIT_DISTRIBUTION':
      return EnforcementActionType.limitDistribution;
    case 'AGE_RESTRICT':
      return EnforcementActionType.ageRestrict;
    case 'FEATURE_RESTRICT':
      return EnforcementActionType.featureRestrict;
    case 'TEMPORARY_ACCOUNT_RESTRICT':
      return EnforcementActionType.temporaryAccountRestrict;
    case 'PERMANENT_BAN':
      return EnforcementActionType.permanentBan;
    default:
      return EnforcementActionType.unknown;
  }
}

enum EnforcementStatus { active, reversed, expired, unknown }

EnforcementStatus _statusFromApi(String value) {
  switch (value) {
    case 'ACTIVE':
      return EnforcementStatus.active;
    case 'REVERSED':
      return EnforcementStatus.reversed;
    case 'EXPIRED':
      return EnforcementStatus.expired;
    default:
      return EnforcementStatus.unknown;
  }
}

enum AppealStatus { submitted, underReview, accepted, rejected, unknown }

AppealStatus _appealStatusFromApi(String value) {
  switch (value) {
    case 'SUBMITTED':
      return AppealStatus.submitted;
    case 'UNDER_REVIEW':
      return AppealStatus.underReview;
    case 'ACCEPTED':
      return AppealStatus.accepted;
    case 'REJECTED':
      return AppealStatus.rejected;
    default:
      return AppealStatus.unknown;
  }
}

class AppealSummary extends Equatable {
  const AppealSummary({required this.id, required this.status, this.decidedAt, this.decisionNotes});

  factory AppealSummary.fromJson(Map<String, dynamic> json) {
    return AppealSummary(
      id: json['id'] as String,
      status: _appealStatusFromApi(json['status'] as String),
      decidedAt: json['decidedAt'] == null ? null : DateTime.parse(json['decidedAt'] as String),
      decisionNotes: json['decisionNotes'] as String?,
    );
  }

  final String id;
  final AppealStatus status;
  final DateTime? decidedAt;
  final String? decisionNotes;

  @override
  List<Object?> get props => [id, status, decidedAt, decisionNotes];
}

class EnforcementActionModel extends Equatable {
  const EnforcementActionModel({
    required this.id,
    required this.actionType,
    this.category,
    required this.reason,
    this.contentType,
    required this.status,
    required this.createdAt,
    this.expiresAt,
    this.reversedAt,
    this.reversalReason,
    this.appeal,
  });

  factory EnforcementActionModel.fromJson(Map<String, dynamic> json) {
    return EnforcementActionModel(
      id: json['id'] as String,
      actionType: _actionTypeFromApi(json['actionType'] as String),
      category: json['category'] as String?,
      reason: json['reason'] as String,
      contentType: json['contentType'] as String?,
      status: _statusFromApi(json['status'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      expiresAt: json['expiresAt'] == null ? null : DateTime.parse(json['expiresAt'] as String),
      reversedAt: json['reversedAt'] == null ? null : DateTime.parse(json['reversedAt'] as String),
      reversalReason: json['reversalReason'] as String?,
      appeal: json['appeal'] == null ? null : AppealSummary.fromJson(json['appeal'] as Map<String, dynamic>),
    );
  }

  final String id;
  final EnforcementActionType actionType;
  final String? category;
  final String reason;
  final String? contentType;
  final EnforcementStatus status;
  final DateTime createdAt;
  final DateTime? expiresAt;
  final DateTime? reversedAt;
  final String? reversalReason;
  final AppealSummary? appeal;

  bool get isActive => status == EnforcementStatus.active;
  bool get canAppeal => isActive && appeal == null;

  String get title {
    switch (actionType) {
      case EnforcementActionType.warn:
        return 'Warning issued';
      case EnforcementActionType.contentRemoved:
        return 'Content removed';
      case EnforcementActionType.limitDistribution:
        return 'Content distribution limited';
      case EnforcementActionType.ageRestrict:
        return 'Content age-restricted';
      case EnforcementActionType.featureRestrict:
        return 'Feature restricted';
      case EnforcementActionType.temporaryAccountRestrict:
        return 'Account temporarily restricted';
      case EnforcementActionType.permanentBan:
        return 'Account permanently banned';
      case EnforcementActionType.unknown:
        return 'Enforcement action';
    }
  }

  @override
  List<Object?> get props => [id, actionType, status, createdAt];
}

class AccountStatusModel extends Equatable {
  const AccountStatusModel({required this.accountStanding, required this.enforcementHistory});

  factory AccountStatusModel.fromJson(Map<String, dynamic> json) {
    return AccountStatusModel(
      accountStanding: json['accountStanding'] as String,
      enforcementHistory: (json['enforcementHistory'] as List).map((e) => EnforcementActionModel.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  final String accountStanding;
  final List<EnforcementActionModel> enforcementHistory;

  bool get isInGoodStanding => accountStanding == 'ACTIVE';

  @override
  List<Object?> get props => [accountStanding, enforcementHistory];
}

/// Report reasons shown in the client — mirrors the backend's
/// `SafetyReportReasonCategory` enum. Kept as a small, curated set in the
/// UI (TikTok's own report sheet groups similarly) rather than exposing
/// every internal category name.
enum ReportReason {
  sexualNudity,
  violence,
  hateHarassment,
  bullying,
  scamFraud,
  spam,
  impersonation,
  underageUser,
  other,
}

extension ReportReasonApi on ReportReason {
  String get apiValue => switch (this) {
        ReportReason.sexualNudity => 'SEXUAL_NUDITY',
        ReportReason.violence => 'VIOLENCE',
        ReportReason.hateHarassment => 'HATE_HARASSMENT',
        ReportReason.bullying => 'BULLYING',
        ReportReason.scamFraud => 'SCAM_FRAUD',
        ReportReason.spam => 'SPAM',
        ReportReason.impersonation => 'IMPERSONATION',
        ReportReason.underageUser => 'UNDERAGE_USER',
        ReportReason.other => 'OTHER',
      };

  String get label => switch (this) {
        ReportReason.sexualNudity => 'Nudity or sexual content',
        ReportReason.violence => 'Violent or graphic content',
        ReportReason.hateHarassment => 'Hate speech or harassment',
        ReportReason.bullying => 'Bullying',
        ReportReason.scamFraud => 'Scam or fraud',
        ReportReason.spam => 'Spam',
        ReportReason.impersonation => 'Impersonation',
        ReportReason.underageUser => 'Underage user',
        ReportReason.other => 'Something else',
      };
}

/// Mirrors the backend's `SafetyReportTargetType` — only the values the
/// client actually reports today are included; more are added as report
/// entry points are wired into more screens.
enum ReportTargetType { userAccount, video, videoComment, photoPost, textPost, story, message, liveSession, liveChatMessage }

extension ReportTargetTypeApi on ReportTargetType {
  String get apiValue => switch (this) {
        ReportTargetType.userAccount => 'USER_ACCOUNT',
        ReportTargetType.video => 'VIDEO',
        ReportTargetType.videoComment => 'VIDEO_COMMENT',
        ReportTargetType.photoPost => 'PHOTO_POST',
        ReportTargetType.textPost => 'TEXT_POST',
        ReportTargetType.story => 'STORY',
        ReportTargetType.message => 'MESSAGE',
        ReportTargetType.liveSession => 'LIVE_SESSION',
        ReportTargetType.liveChatMessage => 'LIVE_CHAT_MESSAGE',
      };
}
