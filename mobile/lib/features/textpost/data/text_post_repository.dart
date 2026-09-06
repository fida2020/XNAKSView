import '../../../core/network/api_client.dart';
import '../domain/text_post_model.dart';

class TextPostRepository {
  const TextPostRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<TextPostModel> create({required String text, String? backgroundStyle}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/text-posts',
      data: {'text': text, 'backgroundStyle': ?backgroundStyle},
    );
    return TextPostModel.fromJson(response.data!);
  }

  Future<List<TextPostModel>> fetchForUser(String userId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/$userId/text-posts');
    return (response.data!['textPosts'] as List).map((p) => TextPostModel.fromJson(p as Map<String, dynamic>)).toList();
  }

  Future<void> delete(String id) => _apiClient.delete<void>('/text-posts/$id');

  Future<void> like(String id) => _apiClient.post<void>('/text-posts/$id/like');

  Future<void> unlike(String id) => _apiClient.delete<void>('/text-posts/$id/like');
}
