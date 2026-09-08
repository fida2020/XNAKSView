import 'package:equatable/equatable.dart';

/// A User or Creator level snapshot — server-authoritative in every field;
/// the client never computes `currentLevel`/`nextLevelXP` itself (see
/// backend `lib/gamification/xpEngine.ts`).
class LevelState extends Equatable {
  const LevelState({
    required this.currentLevel,
    required this.currentXP,
    required this.lifetimeXP,
    required this.nextLevelXP,
  });

  factory LevelState.fromJson(Map<String, dynamic> json) {
    return LevelState(
      currentLevel: json['currentLevel'] as int,
      currentXP: json['currentXP'] as int,
      lifetimeXP: json['lifetimeXP'] as int,
      nextLevelXP: json['nextLevelXP'] as int,
    );
  }

  final int currentLevel;
  final int currentXP;
  final int lifetimeXP;

  /// 0 once the account has reached the highest configured level — never
  /// divide by this without checking for zero first.
  final int nextLevelXP;

  double get progress => nextLevelXP == 0 ? 1.0 : (currentXP / nextLevelXP).clamp(0.0, 1.0);

  @override
  List<Object?> get props => [currentLevel, currentXP, lifetimeXP, nextLevelXP];
}

class EarnedBadge extends Equatable {
  const EarnedBadge({
    required this.id,
    required this.slug,
    required this.name,
    required this.description,
    required this.category,
    required this.earnedAt,
    this.iconKey,
  });

  factory EarnedBadge.fromJson(Map<String, dynamic> json) {
    return EarnedBadge(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      category: json['category'] as String,
      iconKey: json['iconKey'] as String?,
      earnedAt: DateTime.parse(json['earnedAt'] as String),
    );
  }

  final String id;
  final String slug;
  final String name;
  final String description;
  final String category;
  final String? iconKey;
  final DateTime earnedAt;

  @override
  List<Object?> get props => [id, slug, earnedAt];
}

class AchievementProgress extends Equatable {
  const AchievementProgress({
    required this.id,
    required this.slug,
    required this.name,
    required this.description,
    required this.category,
    required this.xpReward,
    required this.progressValue,
    this.unlockedAt,
  });

  factory AchievementProgress.fromJson(Map<String, dynamic> json) {
    return AchievementProgress(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      category: json['category'] as String,
      xpReward: json['xpReward'] as int,
      progressValue: json['progressValue'] as int,
      unlockedAt: json['unlockedAt'] != null ? DateTime.parse(json['unlockedAt'] as String) : null,
    );
  }

  final String id;
  final String slug;
  final String name;
  final String description;
  final String category;
  final int xpReward;
  final int progressValue;
  final DateTime? unlockedAt;

  bool get isUnlocked => unlockedAt != null;

  @override
  List<Object?> get props => [id, progressValue, unlockedAt];
}

class StreakState extends Equatable {
  const StreakState({
    required this.type,
    required this.scopeId,
    required this.currentCount,
    required this.longestCount,
    this.lastActivityDate,
  });

  factory StreakState.fromJson(Map<String, dynamic> json) {
    return StreakState(
      type: json['type'] as String,
      scopeId: json['scopeId'] as String,
      currentCount: json['currentCount'] as int,
      longestCount: json['longestCount'] as int,
      lastActivityDate: json['lastActivityDate'] != null ? DateTime.parse(json['lastActivityDate'] as String) : null,
    );
  }

  final String type;
  final String scopeId;
  final int currentCount;
  final int longestCount;
  final DateTime? lastActivityDate;

  @override
  List<Object?> get props => [type, scopeId, currentCount, longestCount];
}

/// A LIVE Fan Club membership view — XNAKView's own equivalent of TikTok
/// LIVE's Fan Club (see backend `lib/gamification/fanClub.ts`). `null` means
/// the caller isn't currently a member (never inferred from an empty list).
class FanClubMembershipState extends Equatable {
  const FanClubMembershipState({
    required this.fanLevel,
    required this.fanXP,
    required this.nextLevelXP,
    required this.lifetimeFanXP,
    required this.joinedAt,
  });

  factory FanClubMembershipState.fromJson(Map<String, dynamic> json) {
    return FanClubMembershipState(
      fanLevel: json['fanLevel'] as int,
      fanXP: json['fanXP'] as int,
      nextLevelXP: json['nextLevelXP'] as int,
      lifetimeFanXP: json['lifetimeFanXP'] as int,
      joinedAt: DateTime.parse(json['joinedAt'] as String),
    );
  }

  final int fanLevel;
  final int fanXP;
  final int nextLevelXP;
  final int lifetimeFanXP;
  final DateTime joinedAt;

  double get progress => nextLevelXP == 0 ? 1.0 : (fanXP / nextLevelXP).clamp(0.0, 1.0);

  @override
  List<Object?> get props => [fanLevel, fanXP, nextLevelXP];
}

class FanClubView extends Equatable {
  const FanClubView({
    required this.exists,
    this.id,
    this.creatorId,
    this.name,
    this.badgeEmoji,
    this.memberCount,
    this.membership,
  });

  factory FanClubView.fromJson(Map<String, dynamic> json) {
    if (json['exists'] != true) return const FanClubView(exists: false);
    return FanClubView(
      exists: true,
      id: json['id'] as String,
      creatorId: json['creatorId'] as String,
      name: json['name'] as String,
      badgeEmoji: json['badgeEmoji'] as String?,
      memberCount: json['memberCount'] as int?,
      membership: json['membership'] != null ? FanClubMembershipState.fromJson(json['membership'] as Map<String, dynamic>) : null,
    );
  }

  final bool exists;
  final String? id;
  final String? creatorId;
  final String? name;
  final String? badgeEmoji;
  final int? memberCount;
  final FanClubMembershipState? membership;

  bool get isMember => membership != null;

  @override
  List<Object?> get props => [exists, id, membership];
}

enum LeaderboardType { creatorDiamonds, liveHours, giftSenders, fanClubXp, teamPerformance }

extension LeaderboardTypeApi on LeaderboardType {
  String get apiValue {
    switch (this) {
      case LeaderboardType.creatorDiamonds:
        return 'CREATOR_DIAMONDS';
      case LeaderboardType.liveHours:
        return 'LIVE_HOURS';
      case LeaderboardType.giftSenders:
        return 'GIFT_SENDERS';
      case LeaderboardType.fanClubXp:
        return 'FAN_CLUB_XP';
      case LeaderboardType.teamPerformance:
        return 'TEAM_PERFORMANCE';
    }
  }

  String get label {
    switch (this) {
      case LeaderboardType.creatorDiamonds:
        return 'Top Creators';
      case LeaderboardType.liveHours:
        return 'LIVE Hours';
      case LeaderboardType.giftSenders:
        return 'Top Gifters';
      case LeaderboardType.fanClubXp:
        return 'Fan Club';
      case LeaderboardType.teamPerformance:
        return 'Teams';
    }
  }
}

enum LeaderboardPeriod { daily, weekly, monthly, allTime }

extension LeaderboardPeriodApi on LeaderboardPeriod {
  String get apiValue {
    switch (this) {
      case LeaderboardPeriod.daily:
        return 'DAILY';
      case LeaderboardPeriod.weekly:
        return 'WEEKLY';
      case LeaderboardPeriod.monthly:
        return 'MONTHLY';
      case LeaderboardPeriod.allTime:
        return 'ALL_TIME';
    }
  }

  String get label {
    switch (this) {
      case LeaderboardPeriod.daily:
        return 'Daily';
      case LeaderboardPeriod.weekly:
        return 'Weekly';
      case LeaderboardPeriod.monthly:
        return 'Monthly';
      case LeaderboardPeriod.allTime:
        return 'All-time';
    }
  }
}

class LeaderboardEntryModel extends Equatable {
  const LeaderboardEntryModel({required this.subjectId, required this.rank, required this.score});

  factory LeaderboardEntryModel.fromJson(Map<String, dynamic> json) {
    return LeaderboardEntryModel(
      subjectId: json['subjectId'] as String,
      rank: json['rank'] as int,
      score: json['score'] as String,
    );
  }

  final String subjectId;
  final int rank;
  final String score;

  @override
  List<Object?> get props => [subjectId, rank, score];
}

class GamificationNotificationModel extends Equatable {
  const GamificationNotificationModel({
    required this.id,
    required this.type,
    required this.payload,
    required this.createdAt,
    this.readAt,
  });

  factory GamificationNotificationModel.fromJson(Map<String, dynamic> json) {
    return GamificationNotificationModel(
      id: json['id'] as String,
      type: json['type'] as String,
      payload: (json['payload'] as Map<String, dynamic>?) ?? const {},
      createdAt: DateTime.parse(json['createdAt'] as String),
      readAt: json['readAt'] != null ? DateTime.parse(json['readAt'] as String) : null,
    );
  }

  final String id;
  final String type;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final DateTime? readAt;

  bool get isUnread => readAt == null;

  @override
  List<Object?> get props => [id, type, readAt];
}
