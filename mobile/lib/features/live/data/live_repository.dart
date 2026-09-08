import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/live_chat_message_model.dart';
import '../domain/live_guest_model.dart';
import '../domain/live_match_model.dart';
import '../domain/live_session_model.dart';

class LiveRepository {
  const LiveRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<({LiveSessionModel liveSession, LiveConnectionInfo connection})> startLive({
    required String title,
    String? category,
    File? thumbnail,
    /// LIVE Goal — a real Coin-spend target (see backend's giftService.ts,
    /// incremented only by real Gift sends). Omit for no goal.
    String? goalTitle,
    int? goalTargetCoins,
    bool isVoiceOnly = false,
    bool subscriberOnlyChat = false,
    bool replayEnabled = false,
  }) async {
    final formData = FormData.fromMap({
      'title': title,
      if (category != null && category.isNotEmpty) 'category': category,
      if (thumbnail != null)
        'thumbnail': await MultipartFile.fromFile(thumbnail.path, filename: thumbnail.uri.pathSegments.last),
      if (goalTargetCoins != null) 'goalTargetCoins': '$goalTargetCoins',
      if (goalTargetCoins != null && goalTitle != null && goalTitle.isNotEmpty) 'goalTitle': goalTitle,
      'isVoiceOnly': '$isVoiceOnly',
      'subscriberOnlyChat': '$subscriberOnlyChat',
      'replayEnabled': '$replayEnabled',
    });

    final response = await _apiClient.post<Map<String, dynamic>>('/live', data: formData);
    final data = response.data!;
    return (
      liveSession: LiveSessionModel.fromJson(data['liveSession'] as Map<String, dynamic>),
      connection: LiveConnectionInfo.fromJson(data),
    );
  }

  Future<LiveSessionPage> discover({String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/live',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return LiveSessionPage.fromJson(response.data!);
  }

  Future<LiveSessionModel> fetchLiveSession(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/live/$id');
    return LiveSessionModel.fromJson(response.data!);
  }

  Future<LiveConnectionInfo> reconnectAsHost(String id) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/$id/reconnect');
    return LiveConnectionInfo.fromJson(response.data!);
  }

  Future<LiveSessionModel> endLive(String id) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/$id/end');
    return LiveSessionModel.fromJson(response.data!);
  }

  Future<({LiveConnectionInfo connection, int viewerCount})> join(String id) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/$id/join');
    final data = response.data!;
    return (connection: LiveConnectionInfo.fromJson(data), viewerCount: data['viewerCount'] as int);
  }

  Future<int> leave(String id) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/$id/leave');
    return response.data!['viewerCount'] as int;
  }

  Future<List<LiveChatMessageModel>> fetchChat(String id, {String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/live/$id/chat',
      queryParameters: {'cursor': ?cursor},
    );
    return (response.data!['messages'] as List)
        .map((item) => LiveChatMessageModel.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Real-time, ephemeral LIVE reaction (see backend's emitToLiveSession) —
  /// no persisted row, matching a real reaction burst's transient nature.
  Future<void> sendReaction(String liveSessionId, String emoji) =>
      _apiClient.post<void>('/live/$liveSessionId/reactions', data: {'emoji': emoji});

  Future<LiveChatMessageModel> sendChatMessage(String id, String text) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/$id/chat', data: {'text': text});
    final data = response.data!;
    return LiveChatMessageModel(
      id: data['id'] as String,
      liveSessionId: data['liveSessionId'] as String,
      userId: data['userId'] as String,
      text: data['text'] as String,
      createdAt: DateTime.parse(data['createdAt'] as String),
    );
  }

  /// The currently INVITED/ACTIVE co-hosts/guests of a LIVE session — used
  /// only to let a viewer pick a Gift recipient and to label who a Gift
  /// went to (Step 7). The server independently re-validates any chosen
  /// recipient against live state at send time; this list is a display aid,
  /// never trusted as the actual authorization.
  Future<({List<LiveGuestModel> guests, int maxGuestSlots})> fetchGuests(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/live/$id/guests');
    final data = response.data!;
    return (
      guests: (data['guests'] as List).map((item) => LiveGuestModel.fromJson(item as Map<String, dynamic>)).toList(),
      maxGuestSlots: data['maxGuestSlots'] as int,
    );
  }

  Future<void> report(String id, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/live/$id/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }

  // ---------------------------------------------------------------------
  // Co-host / multi-guest (host-side management) — the invited user's own
  // accept/decline is a real, working endpoint too, but there is currently
  // no way for that user to discover a pending invite (no push notice, no
  // "my pending invites" listing), so no mobile UI calls it yet — see the
  // Step 7 UI report for this disclosed gap.
  // ---------------------------------------------------------------------

  Future<void> inviteGuest(String liveSessionId, {required String userId, String role = 'GUEST'}) {
    return _apiClient.post<void>('/live/$liveSessionId/guests/invite', data: {'userId': userId, 'role': role});
  }

  Future<void> removeGuest(String liveSessionId, String userId) {
    return _apiClient.post<void>('/live/$liveSessionId/guests/$userId/remove');
  }

  // ---------------------------------------------------------------------
  // LIVE Match / Battle
  // ---------------------------------------------------------------------

  Future<LiveMatchModel> challengeSession(
    String liveSessionId, {
    required String opponentSessionId,
    int durationSeconds = 180,
    LiveMatchType matchType = LiveMatchType.solo,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/live/$liveSessionId/match',
      data: {
        'opponentSessionId': opponentSessionId,
        'durationSeconds': durationSeconds,
        'matchType': matchType == LiveMatchType.team ? 'TEAM' : 'SOLO',
      },
    );
    return LiveMatchModel.fromJson(response.data!);
  }

  /// The current PENDING/ACTIVE match for this session, or `null` — how a
  /// challenged host discovers an incoming challenge, and how any screen
  /// knows to render the Battle scoreboard.
  Future<LiveMatchModel?> fetchCurrentMatch(String liveSessionId) async {
    final response = await _apiClient.get<Map<String, dynamic>?>('/live/$liveSessionId/match');
    final data = response.data;
    return data == null ? null : LiveMatchModel.fromJson(data);
  }

  Future<LiveMatchModel> fetchMatch(String matchId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/live/matches/$matchId');
    return LiveMatchModel.fromJson(response.data!);
  }

  Future<LiveMatchModel> acceptMatch(String matchId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/$matchId/accept');
    return LiveMatchModel.fromJson(response.data!);
  }

  Future<LiveMatchModel> declineMatch(String matchId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/$matchId/decline');
    return LiveMatchModel.fromJson(response.data!);
  }

  Future<LiveMatchModel> scoreMatch(String matchId, {required String side, int increment = 1}) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/$matchId/score', data: {'side': side, 'increment': increment});
    return LiveMatchModel.fromJson(response.data!);
  }

  Future<LiveMatchModel> endMatch(String matchId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/$matchId/end');
    return LiveMatchModel.fromJson(response.data!);
  }

  // ---------------------------------------------------------------------
  // Team Match — additional teammates on a TEAM match's side
  // ---------------------------------------------------------------------

  Future<LiveMatchTeamMemberModel> inviteTeamMember(String matchId, {required String liveSessionId, required String side}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/live/matches/$matchId/team/invite',
      data: {'liveSessionId': liveSessionId, 'side': side},
    );
    return LiveMatchTeamMemberModel.fromJson(response.data!);
  }

  Future<LiveMatchTeamMemberModel> acceptTeamInvite(String memberId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/team/$memberId/accept');
    return LiveMatchTeamMemberModel.fromJson(response.data!);
  }

  Future<LiveMatchTeamMemberModel> declineTeamInvite(String memberId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/team/$memberId/decline');
    return LiveMatchTeamMemberModel.fromJson(response.data!);
  }

  Future<LiveMatchTeamMemberModel> removeTeamMember(String memberId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/team/$memberId/remove');
    return LiveMatchTeamMemberModel.fromJson(response.data!);
  }

  Future<LiveMatchTeamMemberModel> leaveTeamMatch(String memberId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/live/matches/team/$memberId/leave');
    return LiveMatchTeamMemberModel.fromJson(response.data!);
  }
}
