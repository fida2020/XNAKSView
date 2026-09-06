import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../video/domain/video_model.dart' show VideoAuthor;
import '../domain/story_model.dart';

class StoriesRepository {
  const StoriesRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<StoryModel> create({required File file, required StoryMediaType mediaType, String? caption}) async {
    final formData = FormData.fromMap({
      'media': await MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
      'mediaType': mediaType == StoryMediaType.video ? 'VIDEO' : 'PHOTO',
      'caption': ?caption,
    });
    final response = await _apiClient.post<Map<String, dynamic>>('/stories', data: formData, sendTimeout: const Duration(minutes: 5));
    return StoryModel.fromJson(response.data!);
  }

  Future<List<StoryModel>> fetchFeed() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/stories/feed');
    return (response.data!['stories'] as List).map((s) => StoryModel.fromJson(s as Map<String, dynamic>)).toList();
  }

  /// Fetching a story records the caller's view server-side (idempotent).
  Future<StoryModel> viewStory(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/stories/$id');
    return StoryModel.fromJson(response.data!);
  }

  Future<List<VideoAuthor>> fetchViewers(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/stories/$id/viewers');
    return (response.data!['viewers'] as List).map((v) => VideoAuthor.fromJson(v as Map<String, dynamic>)).toList();
  }

  Future<void> reply(String id, String text) => _apiClient.post<void>('/stories/$id/reply', data: {'text': text});

  Future<void> delete(String id) => _apiClient.delete<void>('/stories/$id');

  Future<void> report(String id, {required String reason}) => _apiClient.post<void>('/stories/$id/report', data: {'reason': reason});
}
