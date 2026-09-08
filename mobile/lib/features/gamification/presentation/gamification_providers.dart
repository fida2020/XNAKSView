import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/gamification_repository.dart';
import '../data/teams_repository.dart';
import '../domain/gamification_models.dart';
import '../domain/team_models.dart';

final gamificationRepositoryProvider = Provider<GamificationRepository>((ref) {
  return GamificationRepository(ref.watch(apiClientProvider));
});

final teamsRepositoryProvider = Provider<TeamsRepository>((ref) {
  return TeamsRepository(ref.watch(apiClientProvider));
});

final userLevelProvider = FutureProvider.autoDispose<LevelState>((ref) {
  return ref.watch(gamificationRepositoryProvider).fetchUserLevel();
});

final creatorLevelProvider = FutureProvider.autoDispose<LevelState>((ref) {
  return ref.watch(gamificationRepositoryProvider).fetchCreatorLevel();
});

final badgesProvider = FutureProvider.autoDispose<List<EarnedBadge>>((ref) {
  return ref.watch(gamificationRepositoryProvider).fetchBadges();
});

final achievementsProvider = FutureProvider.autoDispose<List<AchievementProgress>>((ref) {
  return ref.watch(gamificationRepositoryProvider).fetchAchievements();
});

final streaksProvider = FutureProvider.autoDispose<List<StreakState>>((ref) {
  return ref.watch(gamificationRepositoryProvider).fetchStreaks();
});

/// A Fan Club view for one specific creator — keyed by `creatorId` so a
/// viewer can hold several open (e.g. across LIVEs) without them clobbering
/// each other, and `.refresh()` after join/leave so the LIVE overlay updates
/// immediately without a full screen rebuild.
final fanClubProvider = FutureProvider.autoDispose.family<FanClubView, String>((ref, creatorId) {
  return ref.watch(gamificationRepositoryProvider).fetchFanClub(creatorId);
});

final myTeamsProvider = FutureProvider.autoDispose<List<TeamModel>>((ref) {
  return ref.watch(teamsRepositoryProvider).fetchMyTeams();
});
