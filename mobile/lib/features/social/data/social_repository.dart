import '../../../core/network/api_client.dart';
import '../../video/domain/video_model.dart' show VideoAuthor;

class SocialRepository {
  const SocialRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<VideoAuthor>> fetchFollowers(String userId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/$userId/followers');
    return (response.data!['users'] as List).map((u) => VideoAuthor.fromJson(u as Map<String, dynamic>)).toList();
  }

  Future<List<VideoAuthor>> fetchFollowing(String userId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/$userId/following');
    return (response.data!['users'] as List).map((u) => VideoAuthor.fromJson(u as Map<String, dynamic>)).toList();
  }

  Future<void> removeFollower(String selfUserId, String followerId) =>
      _apiClient.delete<void>('/users/$selfUserId/followers/$followerId');

  Future<List<VideoAuthor>> suggestedAccounts() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/suggested');
    return (response.data!['users'] as List).map((u) => VideoAuthor.fromJson(u as Map<String, dynamic>)).toList();
  }

  Future<void> follow(String userId) => _apiClient.post<void>('/users/$userId/follow');

  Future<void> unfollow(String userId) => _apiClient.delete<void>('/users/$userId/follow');
}
