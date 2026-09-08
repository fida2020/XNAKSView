import '../../../core/network/api_client.dart';
import '../domain/team_models.dart';

/// LIVE Teams (Step 11) — an XNAKView-original creator/host team feature;
/// see backend `lib/gamification/teams.ts`'s own doc comment for why this
/// isn't a TikTok port.
class TeamsRepository {
  const TeamsRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<TeamModel> createTeam({required String name, String? description}) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/teams', data: {'name': name, 'description': ?description});
    return TeamModel.fromJson(response.data!);
  }

  Future<List<TeamModel>> fetchMyTeams() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/teams/me');
    return (response.data!['teams'] as List).map((t) => TeamModel.fromJson(t as Map<String, dynamic>)).toList();
  }

  Future<TeamDetail> fetchTeam(String teamId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/teams/$teamId');
    return TeamDetail.fromJson(response.data!);
  }

  Future<void> updateTeam(String teamId, {String? name, String? description}) async {
    await _apiClient.patch<Map<String, dynamic>>('/teams/$teamId', data: {'name': ?name, 'description': ?description});
  }

  Future<void> disbandTeam(String teamId) async {
    await _apiClient.delete<Map<String, dynamic>>('/teams/$teamId');
  }

  Future<void> leaveTeam(String teamId) async {
    await _apiClient.post<Map<String, dynamic>>('/teams/$teamId/leave');
  }

  Future<void> transferOwnership(String teamId, String newOwnerId) async {
    await _apiClient.post<Map<String, dynamic>>('/teams/$teamId/transfer-ownership', data: {'newOwnerId': newOwnerId});
  }

  Future<void> inviteMember(String teamId, String userId) async {
    await _apiClient.post<Map<String, dynamic>>('/teams/$teamId/invites', data: {'userId': userId});
  }

  Future<void> cancelInvite(String teamId, String inviteId) async {
    await _apiClient.delete<Map<String, dynamic>>('/teams/$teamId/invites/$inviteId');
  }

  Future<List<TeamInviteModel>> fetchReceivedInvites() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/teams/invites/received');
    return (response.data!['invites'] as List).map((i) => TeamInviteModel.fromJson(i as Map<String, dynamic>)).toList();
  }

  Future<void> respondToInvite(String inviteId, bool accept) async {
    await _apiClient.post<Map<String, dynamic>>('/teams/invites/$inviteId/respond', data: {'accept': accept});
  }

  Future<void> removeMember(String teamId, String userId) async {
    await _apiClient.delete<Map<String, dynamic>>('/teams/$teamId/members/$userId');
  }

  Future<void> changeMemberRole(String teamId, String userId, TeamRole role) async {
    await _apiClient.patch<Map<String, dynamic>>('/teams/$teamId/members/$userId/role', data: {'role': role == TeamRole.manager ? 'MANAGER' : 'MEMBER'});
  }

  Future<List<TeamTargetModel>> fetchTargets(String teamId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/teams/$teamId/targets');
    return (response.data!['targets'] as List).map((t) => TeamTargetModel.fromJson(t as Map<String, dynamic>)).toList();
  }

  Future<void> createTarget(String teamId, {required TeamTargetMetric metric, required int targetValue, required DateTime periodStart, required DateTime periodEnd}) async {
    await _apiClient.post<Map<String, dynamic>>(
      '/teams/$teamId/targets',
      data: {
        'metric': metric.apiValue,
        'targetValue': targetValue,
        'periodStart': periodStart.toIso8601String(),
        'periodEnd': periodEnd.toIso8601String(),
      },
    );
  }

  Future<void> cancelTarget(String teamId, String targetId) async {
    await _apiClient.delete<Map<String, dynamic>>('/teams/$teamId/targets/$targetId');
  }

  Future<({List<TeamActivityEntryModel> activity, String? nextCursor})> fetchActivity(String teamId, {String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/teams/$teamId/activity', queryParameters: {'cursor': ?cursor});
    final data = response.data!;
    return (
      activity: (data['activity'] as List).map((a) => TeamActivityEntryModel.fromJson(a as Map<String, dynamic>)).toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<List<TeamLeaderboardEntry>> fetchLeaderboard({required String period}) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/teams/leaderboard', queryParameters: {'period': period});
    return (response.data!['entries'] as List).map((e) => TeamLeaderboardEntry.fromJson(e as Map<String, dynamic>)).toList();
  }
}
