import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/comment_model.dart';
import '../domain/user_profile_summary.dart';
import '../domain/video_model.dart';

class VideoRepository {
  const VideoRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<FeedPage> fetchFeed({String? cursor, int limit = 10}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/feed',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return FeedPage.fromJson(response.data!);
  }

  Future<FeedPage> fetchUserVideos(String userId, {String? cursor, int limit = 12}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/users/$userId/videos',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return FeedPage.fromJson(response.data!);
  }

  Future<VideoModel> fetchVideo(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/videos/$id');
    return VideoModel.fromJson(response.data!);
  }

  Future<void> deleteVideo(String id) => _apiClient.delete<void>('/videos/$id');

  Future<VideoModel> uploadVideo({
    required File file,
    String? caption,
    required VideoVisibility visibility,
    void Function(double progress)? onProgress,
  }) async {
    final formData = FormData.fromMap({
      'video': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      if (caption != null && caption.isNotEmpty) 'caption': caption,
      'visibility': visibility == VideoVisibility.private ? 'PRIVATE' : 'PUBLIC',
    });

    final response = await _apiClient.post<Map<String, dynamic>>(
      '/videos',
      data: formData,
      sendTimeout: const Duration(minutes: 5),
      onSendProgress: (sent, total) {
        if (total > 0) onProgress?.call(sent / total);
      },
    );
    return VideoModel.fromJson(response.data!);
  }

  Future<void> like(String videoId) => _apiClient.post<void>('/videos/$videoId/like');

  Future<void> unlike(String videoId) => _apiClient.delete<void>('/videos/$videoId/like');

  Future<CommentsPage> fetchComments(String videoId, {String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/videos/$videoId/comments',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return CommentsPage.fromJson(response.data!);
  }

  Future<CommentModel> createComment(String videoId, String text) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/videos/$videoId/comments', data: {'text': text});
    return CommentModel.fromJson(response.data!);
  }

  Future<void> deleteComment(String commentId) => _apiClient.delete<void>('/comments/$commentId');

  Future<int> shareVideo(String videoId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/videos/$videoId/share');
    return response.data!['shareCount'] as int;
  }

  Future<void> recordView(String videoId) => _apiClient.post<void>('/videos/$videoId/view');

  Future<void> reportVideo(String videoId, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/videos/$videoId/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }

  Future<void> follow(String userId) => _apiClient.post<void>('/users/$userId/follow');

  Future<void> unfollow(String userId) => _apiClient.delete<void>('/users/$userId/follow');

  Future<UserProfileSummary> fetchUserProfile(String userId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/$userId');
    return UserProfileSummary.fromJson(response.data!);
  }
}
