import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/call_model.dart';
import '../domain/conversation_model.dart';
import '../domain/message_model.dart';

class MessagingRepository {
  const MessagingRepository(this._apiClient);

  final ApiClient _apiClient;

  // ---------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------

  Future<ConversationModel> createOrReuseConversation(String userId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/conversations', data: {'userId': userId});
    return ConversationModel.fromJson(response.data!);
  }

  Future<ConversationListPage> listConversations({String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/conversations',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return ConversationListPage.fromJson(response.data!);
  }

  Future<ConversationModel> fetchConversation(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/conversations/$id');
    return ConversationModel.fromJson(response.data!);
  }

  Future<void> acceptConversation(String id) => _apiClient.post<void>('/conversations/$id/accept');

  Future<void> markConversationRead(String id) => _apiClient.post<void>('/conversations/$id/read');

  Future<void> setMuted(String id, bool muted) =>
      muted ? _apiClient.post<void>('/conversations/$id/mute') : _apiClient.delete<void>('/conversations/$id/mute');

  Future<void> setPinned(String id, bool pinned) =>
      pinned ? _apiClient.post<void>('/conversations/$id/pin') : _apiClient.delete<void>('/conversations/$id/pin');

  Future<void> reportConversation(String id, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/conversations/$id/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }

  // ---------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------

  Future<MessagePage> listMessages(String conversationId, {String? cursor, int limit = 30}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/conversations/$conversationId/messages',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return MessagePage.fromJson(response.data!);
  }

  Future<MessageModel> sendTextMessage(String conversationId, {required String clientMessageId, required String text}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/conversations/$conversationId/messages',
      data: {'clientMessageId': clientMessageId, 'text': text},
    );
    return MessageModel.fromJson(response.data!);
  }

  Future<MessageModel> sendVoiceMessage(
    String conversationId, {
    required String clientMessageId,
    required File audioFile,
    void Function(int sent, int total)? onSendProgress,
  }) async {
    final formData = FormData.fromMap({
      'clientMessageId': clientMessageId,
      'audio': await MultipartFile.fromFile(audioFile.path, filename: audioFile.uri.pathSegments.last),
    });
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/conversations/$conversationId/messages/voice',
      data: formData,
      onSendProgress: onSendProgress,
    );
    return MessageModel.fromJson(response.data!);
  }

  Future<void> unsendMessage(String messageId) => _apiClient.delete<void>('/messages/$messageId');

  Future<void> reportMessage(String messageId, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/messages/$messageId/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }

  // ---------------------------------------------------------------------
  // Block / privacy / presence
  // ---------------------------------------------------------------------

  Future<void> blockUser(String userId) => _apiClient.post<void>('/users/$userId/block');

  Future<void> unblockUser(String userId) => _apiClient.delete<void>('/users/$userId/block');

  Future<Map<String, dynamic>> fetchMessagingSettings() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/me/messaging-settings');
    return response.data!;
  }

  Future<Map<String, dynamic>> updateMessagingSettings({String? whoCanMessage, bool? showActivityStatus}) async {
    final response = await _apiClient.patch<Map<String, dynamic>>(
      '/me/messaging-settings',
      data: {
        'whoCanMessage': ?whoCanMessage,
        'showActivityStatus': ?showActivityStatus,
      },
    );
    return response.data!;
  }

  // ---------------------------------------------------------------------
  // Calls
  // ---------------------------------------------------------------------

  Future<CallConnectionInfo> initiateCall(String calleeId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/calls', data: {'calleeId': calleeId});
    return CallConnectionInfo.fromJson(response.data!);
  }

  Future<CallConnectionInfo> acceptCall(String callId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/calls/$callId/accept');
    return CallConnectionInfo.fromJson(response.data!);
  }

  Future<void> declineCall(String callId) => _apiClient.post<void>('/calls/$callId/decline');

  Future<void> cancelCall(String callId) => _apiClient.post<void>('/calls/$callId/cancel');

  Future<CallModel> endCall(String callId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/calls/$callId/end');
    return CallModel.fromJson(response.data!['call'] as Map<String, dynamic>);
  }

  Future<CallHistoryPage> listCallHistory({String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/calls',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return CallHistoryPage.fromJson(response.data!);
  }

  Future<void> reportCall(String callId, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/calls/$callId/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }
}
