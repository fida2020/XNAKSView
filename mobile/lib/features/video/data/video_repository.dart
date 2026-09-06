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
    String? addYoursPrompt,
    String? soundId,
    void Function(double progress)? onProgress,
  }) async {
    final formData = FormData.fromMap({
      'video': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      if (caption != null && caption.isNotEmpty) 'caption': caption,
      'visibility': visibility == VideoVisibility.private ? 'PRIVATE' : 'PUBLIC',
      'addYoursPrompt': ?addYoursPrompt,
      'soundId': ?soundId,
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

  Future<VideoModel> createDuet({required String sourceVideoId, required File file, String? caption}) async {
    final formData = FormData.fromMap({
      'video': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      if (caption != null && caption.isNotEmpty) 'caption': caption,
    });
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/videos/$sourceVideoId/duet',
      data: formData,
      sendTimeout: const Duration(minutes: 5),
    );
    return VideoModel.fromJson(response.data!);
  }

  Future<VideoModel> createStitch({
    required String sourceVideoId,
    required File file,
    String? caption,
    required int sourceStartMs,
    required int sourceEndMs,
  }) async {
    final formData = FormData.fromMap({
      'video': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      if (caption != null && caption.isNotEmpty) 'caption': caption,
      'sourceStartMs': sourceStartMs,
      'sourceEndMs': sourceEndMs,
    });
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/videos/$sourceVideoId/stitch',
      data: formData,
      sendTimeout: const Duration(minutes: 5),
    );
    return VideoModel.fromJson(response.data!);
  }

  Future<VideoModel> respondToAddYours({required String promptVideoId, required File file, String? caption}) async {
    final formData = FormData.fromMap({
      'video': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      if (caption != null && caption.isNotEmpty) 'caption': caption,
    });
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/videos/$promptVideoId/add-yours',
      data: formData,
      sendTimeout: const Duration(minutes: 5),
    );
    return VideoModel.fromJson(response.data!);
  }

  Future<FeedPage> fetchAddYoursResponses(String promptVideoId, {String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/videos/$promptVideoId/add-yours/responses',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return FeedPage.fromJson(response.data!);
  }

  Future<void> like(String videoId) => _apiClient.post<void>('/videos/$videoId/like');

  Future<void> unlike(String videoId) => _apiClient.delete<void>('/videos/$videoId/like');

  Future<void> repost(String videoId) => _apiClient.post<void>('/videos/$videoId/repost');

  Future<void> undoRepost(String videoId) => _apiClient.delete<void>('/videos/$videoId/repost');

  Future<void> favorite(String videoId) => _apiClient.post<void>('/videos/$videoId/favorite');

  Future<void> unfavorite(String videoId) => _apiClient.delete<void>('/videos/$videoId/favorite');

  Future<CommentsPage> fetchComments(String videoId, {String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/videos/$videoId/comments',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return CommentsPage.fromJson(response.data!);
  }

  Future<CommentModel> createComment(String videoId, String text, {String? parentId}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/videos/$videoId/comments',
      data: {'text': text, 'parentId': ?parentId},
    );
    return CommentModel.fromJson(response.data!);
  }

  Future<void> deleteComment(String commentId) => _apiClient.delete<void>('/comments/$commentId');

  Future<List<CommentModel>> fetchReplies(String commentId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/comments/$commentId/replies');
    return (response.data!['replies'] as List).map((r) => CommentModel.fromJson(r as Map<String, dynamic>)).toList();
  }

  Future<void> likeComment(String commentId) => _apiClient.post<void>('/comments/$commentId/like');

  Future<void> unlikeComment(String commentId) => _apiClient.delete<void>('/comments/$commentId/like');

  Future<void> pinComment(String commentId) => _apiClient.post<void>('/comments/$commentId/pin');

  Future<void> unpinComment(String commentId) => _apiClient.delete<void>('/comments/$commentId/pin');

  Future<void> reportComment(String commentId, {required String reason, String? description}) {
    return _apiClient.post<void>(
      '/comments/$commentId/report',
      data: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description},
    );
  }

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

  /// "Use this sound" (Step 6, brief C) — lazily exposes `videoId`'s own
  /// audio as a reusable Sound, returning its id to pass into a new
  /// upload's `soundId`.
  Future<String> useSound(String videoId) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/videos/$videoId/sound');
    return response.data!['id'] as String;
  }

  Future<FeedPage> fetchHashtagVideos(String tag, {String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/hashtags/$tag/videos',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return FeedPage.fromJson(response.data!);
  }

  Future<({String tag, int postCount, bool exists})> fetchHashtag(String tag) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/hashtags/$tag');
    final data = response.data!;
    return (tag: data['tag'] as String, postCount: data['postCount'] as int, exists: data['exists'] as bool);
  }

  /// Single-page video search results — no infinite scroll (a bounded
  /// simplification; the backend itself supports cursor pagination for this
  /// via `GET /search`).
  Future<FeedPage> searchVideos(String query) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/search', queryParameters: {'q': query, 'type': 'videos'});
    return FeedPage.fromJson(response.data!);
  }
}
