import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/live_chat_message_model.dart';
import '../domain/live_session_model.dart';

class LiveRepository {
  const LiveRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<({LiveSessionModel liveSession, LiveConnectionInfo connection})> startLive({
    required String title,
    String? category,
    File? thumbnail,
  }) async {
    final formData = FormData.fromMap({
      'title': title,
      if (category != null && category.isNotEmpty) 'category': category,
      if (thumbnail != null)
        'thumbnail': await MultipartFile.fromFile(thumbnail.path, filename: thumbnail.uri.pathSegments.last),
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

  Future<void> report(String id, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/live/$id/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }
}
