import 'dart:io';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/photo_post_model.dart';

class PhotoPostRepository {
  const PhotoPostRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<PhotoPostModel> create({required List<File> photos, String? caption, String visibility = 'PUBLIC'}) async {
    final formData = FormData.fromMap({
      'photos': [for (final photo in photos) await MultipartFile.fromFile(photo.path, filename: photo.uri.pathSegments.last)],
      'caption': ?caption,
      'visibility': visibility,
    });
    final response = await _apiClient.post<Map<String, dynamic>>('/photo-posts', data: formData, sendTimeout: const Duration(minutes: 5));
    return PhotoPostModel.fromJson(response.data!);
  }

  Future<PhotoPostModel> fetchOne(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/photo-posts/$id');
    return PhotoPostModel.fromJson(response.data!);
  }

  Future<List<PhotoPostModel>> fetchForUser(String userId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/$userId/photo-posts');
    return (response.data!['photoPosts'] as List).map((p) => PhotoPostModel.fromJson(p as Map<String, dynamic>)).toList();
  }

  Future<void> delete(String id) => _apiClient.delete<void>('/photo-posts/$id');

  Future<void> like(String id) => _apiClient.post<void>('/photo-posts/$id/like');

  Future<void> unlike(String id) => _apiClient.delete<void>('/photo-posts/$id/like');

  Future<List<Map<String, dynamic>>> fetchComments(String id) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/photo-posts/$id/comments');
    return (response.data!['comments'] as List).cast<Map<String, dynamic>>();
  }

  Future<void> addComment(String id, String text) => _apiClient.post<void>('/photo-posts/$id/comments', data: {'text': text});

  Future<void> report(String id, {required String reason}) => _apiClient.post<void>('/photo-posts/$id/report', data: {'reason': reason});
}
