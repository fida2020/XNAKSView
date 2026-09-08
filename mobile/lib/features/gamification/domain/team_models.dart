import 'package:equatable/equatable.dart';

enum TeamRole { owner, manager, member }

TeamRole teamRoleFromApi(String value) {
  switch (value) {
    case 'OWNER':
      return TeamRole.owner;
    case 'MANAGER':
      return TeamRole.manager;
    default:
      return TeamRole.member;
  }
}

extension TeamRoleLabel on TeamRole {
  String get label {
    switch (this) {
      case TeamRole.owner:
        return 'Owner';
      case TeamRole.manager:
        return 'Manager';
      case TeamRole.member:
        return 'Member';
    }
  }

  bool get canManage => this == TeamRole.owner || this == TeamRole.manager;
}

class TeamModel extends Equatable {
  const TeamModel({
    required this.id,
    required this.name,
    required this.status,
    required this.ownerId,
    required this.memberCount,
    this.description,
    this.avatarKey,
    this.myRole,
  });

  factory TeamModel.fromJson(Map<String, dynamic> json) {
    return TeamModel(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String,
      ownerId: json['ownerId'] as String,
      memberCount: json['memberCount'] as int,
      description: json['description'] as String?,
      avatarKey: json['avatarKey'] as String?,
      myRole: json['myRole'] != null ? teamRoleFromApi(json['myRole'] as String) : null,
    );
  }

  final String id;
  final String name;
  final String status;
  final String ownerId;
  final int memberCount;
  final String? description;
  final String? avatarKey;
  final TeamRole? myRole;

  @override
  List<Object?> get props => [id, name, status, memberCount, myRole];
}

class TeamMemberModel extends Equatable {
  const TeamMemberModel({required this.userId, required this.role, required this.joinedAt, this.author});

  factory TeamMemberModel.fromJson(Map<String, dynamic> json) {
    return TeamMemberModel(
      userId: json['userId'] as String,
      role: teamRoleFromApi(json['role'] as String),
      joinedAt: DateTime.parse(json['joinedAt'] as String),
      author: json['author'] as Map<String, dynamic>?,
    );
  }

  final String userId;
  final TeamRole role;
  final DateTime joinedAt;
  final Map<String, dynamic>? author;

  String get displayName => (author?['displayName'] as String?) ?? (author?['username'] as String?) ?? 'Member';
  String? get avatarUrl => author?['avatarUrl'] as String?;

  @override
  List<Object?> get props => [userId, role];
}

class TeamDetail extends Equatable {
  const TeamDetail({required this.team, required this.members});

  factory TeamDetail.fromJson(Map<String, dynamic> json) {
    return TeamDetail(
      team: TeamModel.fromJson(json),
      members: (json['members'] as List).map((m) => TeamMemberModel.fromJson(m as Map<String, dynamic>)).toList(),
    );
  }

  final TeamModel team;
  final List<TeamMemberModel> members;

  @override
  List<Object?> get props => [team, members];
}

class TeamInviteModel extends Equatable {
  const TeamInviteModel({required this.id, required this.teamId, required this.status, required this.createdAt, this.team});

  factory TeamInviteModel.fromJson(Map<String, dynamic> json) {
    return TeamInviteModel(
      id: json['id'] as String,
      teamId: json['teamId'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      team: json['team'] != null ? TeamModel.fromJson(json['team'] as Map<String, dynamic>) : null,
    );
  }

  final String id;
  final String teamId;
  final String status;
  final DateTime createdAt;
  final TeamModel? team;

  @override
  List<Object?> get props => [id, status];
}

enum TeamTargetMetric { liveHours, liveSessions, giftsReceivedCoins, teamEngagementPoints }

TeamTargetMetric teamTargetMetricFromApi(String value) {
  switch (value) {
    case 'LIVE_HOURS':
      return TeamTargetMetric.liveHours;
    case 'LIVE_SESSIONS':
      return TeamTargetMetric.liveSessions;
    case 'GIFTS_RECEIVED_COINS':
      return TeamTargetMetric.giftsReceivedCoins;
    default:
      return TeamTargetMetric.teamEngagementPoints;
  }
}

extension TeamTargetMetricApi on TeamTargetMetric {
  String get apiValue {
    switch (this) {
      case TeamTargetMetric.liveHours:
        return 'LIVE_HOURS';
      case TeamTargetMetric.liveSessions:
        return 'LIVE_SESSIONS';
      case TeamTargetMetric.giftsReceivedCoins:
        return 'GIFTS_RECEIVED_COINS';
      case TeamTargetMetric.teamEngagementPoints:
        return 'TEAM_ENGAGEMENT_POINTS';
    }
  }

  String get label {
    switch (this) {
      case TeamTargetMetric.liveHours:
        return 'LIVE minutes';
      case TeamTargetMetric.liveSessions:
        return 'LIVE sessions';
      case TeamTargetMetric.giftsReceivedCoins:
        return 'Gift Coins received';
      case TeamTargetMetric.teamEngagementPoints:
        return 'Engagement points';
    }
  }
}

class TeamTargetModel extends Equatable {
  const TeamTargetModel({
    required this.id,
    required this.metric,
    required this.targetValue,
    required this.currentValue,
    required this.status,
    required this.periodStart,
    required this.periodEnd,
  });

  factory TeamTargetModel.fromJson(Map<String, dynamic> json) {
    return TeamTargetModel(
      id: json['id'] as String,
      metric: teamTargetMetricFromApi(json['metric'] as String),
      targetValue: json['targetValue'] as int,
      currentValue: json['currentValue'] as int,
      status: json['status'] as String,
      periodStart: DateTime.parse(json['periodStart'] as String),
      periodEnd: DateTime.parse(json['periodEnd'] as String),
    );
  }

  final String id;
  final TeamTargetMetric metric;
  final int targetValue;
  final int currentValue;
  final String status;
  final DateTime periodStart;
  final DateTime periodEnd;

  double get progress => targetValue == 0 ? 0 : (currentValue / targetValue).clamp(0.0, 1.0);

  @override
  List<Object?> get props => [id, currentValue, status];
}

class TeamActivityEntryModel extends Equatable {
  const TeamActivityEntryModel({required this.id, required this.type, required this.value, required this.createdAt, this.userId});

  factory TeamActivityEntryModel.fromJson(Map<String, dynamic> json) {
    return TeamActivityEntryModel(
      id: json['id'] as String,
      type: json['type'] as String,
      value: json['value'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
      userId: json['userId'] as String?,
    );
  }

  final String id;
  final String type;
  final int value;
  final DateTime createdAt;
  final String? userId;

  String get label {
    switch (type) {
      case 'LIVE_HOURS_LOGGED':
        return 'Logged $value min of LIVE';
      case 'GIFT_RECEIVED':
        return 'Received a Gift worth $value Coins';
      case 'MEMBER_JOINED':
        return 'A member joined the team';
      case 'MEMBER_LEFT':
        return 'A member left the team';
      case 'MEMBER_REMOVED':
        return 'A member was removed';
      case 'TARGET_CREATED':
        return 'A new target was set';
      case 'TARGET_COMPLETED':
        return 'A target was completed 🎉';
      default:
        return type;
    }
  }

  @override
  List<Object?> get props => [id, type, value];
}

class TeamLeaderboardEntry extends Equatable {
  const TeamLeaderboardEntry({required this.rank, required this.score, this.team});

  factory TeamLeaderboardEntry.fromJson(Map<String, dynamic> json) {
    return TeamLeaderboardEntry(
      rank: json['rank'] as int,
      score: json['score'] as String,
      team: json['team'] != null ? TeamModel.fromJson(json['team'] as Map<String, dynamic>) : null,
    );
  }

  final int rank;
  final String score;
  final TeamModel? team;

  @override
  List<Object?> get props => [rank, score, team];
}
