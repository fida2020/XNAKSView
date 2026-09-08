import 'package:equatable/equatable.dart';

enum LiveMatchStatus { pending, active, ended, cancelled, unknown }

LiveMatchStatus _statusFromApi(String value) {
  switch (value) {
    case 'PENDING':
      return LiveMatchStatus.pending;
    case 'ACTIVE':
      return LiveMatchStatus.active;
    case 'ENDED':
      return LiveMatchStatus.ended;
    case 'CANCELLED':
      return LiveMatchStatus.cancelled;
    default:
      return LiveMatchStatus.unknown;
  }
}

enum LiveMatchType { solo, team, unknown }

LiveMatchType _typeFromApi(String? value) {
  switch (value) {
    case 'TEAM':
      return LiveMatchType.team;
    case 'SOLO':
      return LiveMatchType.solo;
    default:
      return LiveMatchType.unknown;
  }
}

enum LiveMatchTeamMemberStatus { invited, active, declined, removed, left, unknown }

LiveMatchTeamMemberStatus _memberStatusFromApi(String value) {
  switch (value) {
    case 'INVITED':
      return LiveMatchTeamMemberStatus.invited;
    case 'ACTIVE':
      return LiveMatchTeamMemberStatus.active;
    case 'DECLINED':
      return LiveMatchTeamMemberStatus.declined;
    case 'REMOVED':
      return LiveMatchTeamMemberStatus.removed;
    case 'LEFT':
      return LiveMatchTeamMemberStatus.left;
    default:
      return LiveMatchTeamMemberStatus.unknown;
  }
}

/// One additional teammate's own independent LIVE broadcast joined to a
/// side of a TEAM Match — never a guest slot inside the captain's stream,
/// see the backend `LiveMatchTeamMember` model comment.
class LiveMatchTeamMemberModel extends Equatable {
  const LiveMatchTeamMemberModel({
    required this.id,
    required this.matchId,
    required this.liveSessionId,
    required this.side,
    required this.status,
    required this.invitedById,
  });

  factory LiveMatchTeamMemberModel.fromJson(Map<String, dynamic> json) {
    return LiveMatchTeamMemberModel(
      id: json['id'] as String,
      matchId: json['matchId'] as String,
      liveSessionId: json['liveSessionId'] as String,
      side: json['side'] as String,
      status: _memberStatusFromApi(json['status'] as String),
      invitedById: json['invitedById'] as String,
    );
  }

  final String id;
  final String matchId;
  final String liveSessionId;
  final String side;
  final LiveMatchTeamMemberStatus status;
  final String invitedById;

  @override
  List<Object?> get props => [id, side, status];
}

/// LIVE Match/Battle (Step 4, TikTok-style) — two hosts' sessions paired
/// head-to-head. `scoreA`/`scoreB` are plain match-score integers, entirely
/// separate from the Coin/Diamond financial ledgers (a Gift sent mid-Battle
/// contributes to the relevant side server-side, but this model never
/// carries or implies any Coin/money value itself).
///
/// A TEAM match (`matchType`) additionally carries a `teamMembers` roster —
/// `sessionAId`/`sessionBId` remain each side's captain either way; a TEAM
/// match's extra participants each bring their own independent broadcast.
class LiveMatchModel extends Equatable {
  const LiveMatchModel({
    required this.id,
    required this.sessionAId,
    required this.sessionBId,
    this.matchType = LiveMatchType.solo,
    required this.status,
    required this.scoreA,
    required this.scoreB,
    this.winnerSessionId,
    required this.durationSeconds,
    this.startedAt,
    this.endedAt,
    this.teamMembers = const [],
  });

  factory LiveMatchModel.fromJson(Map<String, dynamic> json) {
    return LiveMatchModel(
      id: json['id'] as String,
      sessionAId: json['sessionAId'] as String,
      sessionBId: json['sessionBId'] as String,
      matchType: _typeFromApi(json['matchType'] as String?),
      status: _statusFromApi(json['status'] as String),
      scoreA: json['scoreA'] as int,
      scoreB: json['scoreB'] as int,
      winnerSessionId: json['winnerSessionId'] as String?,
      durationSeconds: json['durationSeconds'] as int,
      startedAt: json['startedAt'] == null ? null : DateTime.parse(json['startedAt'] as String),
      endedAt: json['endedAt'] == null ? null : DateTime.parse(json['endedAt'] as String),
      teamMembers: (json['teamMembers'] as List<dynamic>? ?? [])
          .map((entry) => LiveMatchTeamMemberModel.fromJson(entry as Map<String, dynamic>))
          .toList(),
    );
  }

  final String id;
  final String sessionAId;
  final String sessionBId;
  final LiveMatchType matchType;
  final LiveMatchStatus status;
  final int scoreA;
  final int scoreB;
  final String? winnerSessionId;
  final int durationSeconds;
  final DateTime? startedAt;
  final DateTime? endedAt;
  final List<LiveMatchTeamMemberModel> teamMembers;

  /// Seconds remaining, clamped to zero — `null` while still PENDING.
  int? secondsRemaining() {
    if (startedAt == null || status != LiveMatchStatus.active) return null;
    final elapsed = DateTime.now().difference(startedAt!).inSeconds;
    return (durationSeconds - elapsed).clamp(0, durationSeconds);
  }

  List<LiveMatchTeamMemberModel> teammatesForSide(String side) =>
      teamMembers.where((m) => m.side == side).toList();

  @override
  List<Object?> get props => [id, status, scoreA, scoreB, winnerSessionId, matchType, teamMembers];
}
