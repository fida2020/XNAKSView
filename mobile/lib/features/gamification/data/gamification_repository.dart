import '../../../core/network/api_client.dart';
import '../domain/gamification_models.dart';

/// Step 11 — Levels, badges, achievements, streaks, Fan Club, notifications,
/// and global leaderboards. Every value here is exactly what the backend
/// returned; nothing is computed or inferred client-side (see backend
/// `routes/v1/gamification.ts`).
class GamificationRepository {
  const GamificationRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<LevelState> fetchUserLevel() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gamification/level');
    return LevelState.fromJson(response.data!);
  }

  Future<LevelState> fetchCreatorLevel() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gamification/creator-level');
    return LevelState.fromJson(response.data!);
  }

  Future<List<EarnedBadge>> fetchBadges() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gamification/badges');
    return (response.data!['badges'] as List).map((b) => EarnedBadge.fromJson(b as Map<String, dynamic>)).toList();
  }

  Future<List<AchievementProgress>> fetchAchievements() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gamification/achievements');
    return (response.data!['achievements'] as List).map((a) => AchievementProgress.fromJson(a as Map<String, dynamic>)).toList();
  }

  Future<List<StreakState>> fetchStreaks() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gamification/streaks');
    return (response.data!['streaks'] as List).map((s) => StreakState.fromJson(s as Map<String, dynamic>)).toList();
  }

  Future<FanClubView> fetchFanClub(String creatorId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gamification/fan-clubs/$creatorId');
    return FanClubView.fromJson(response.data!);
  }

  Future<void> joinFanClub(String creatorId) async {
    await _apiClient.post<Map<String, dynamic>>('/gamification/fan-clubs/$creatorId/join');
  }

  Future<void> leaveFanClub(String creatorId) async {
    await _apiClient.post<Map<String, dynamic>>('/gamification/fan-clubs/$creatorId/leave');
  }

  Future<({List<LeaderboardEntryModel> entries, DateTime computedAt})> fetchLeaderboard({
    required LeaderboardType type,
    required LeaderboardPeriod period,
    String? scopeId,
  }) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/gamification/leaderboards',
      queryParameters: {'type': type.apiValue, 'period': period.apiValue, 'scopeId': ?scopeId},
    );
    final data = response.data!;
    return (
      entries: (data['entries'] as List).map((e) => LeaderboardEntryModel.fromJson(e as Map<String, dynamic>)).toList(),
      computedAt: DateTime.parse(data['computedAt'] as String),
    );
  }

  Future<({List<GamificationNotificationModel> notifications, String? nextCursor})> fetchNotifications({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/gamification/notifications',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      notifications: (data['notifications'] as List).map((n) => GamificationNotificationModel.fromJson(n as Map<String, dynamic>)).toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<void> markNotificationRead(String id) async {
    await _apiClient.post<Map<String, dynamic>>('/gamification/notifications/$id/read');
  }
}
