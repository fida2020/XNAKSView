import '../../../core/network/api_client.dart';
import '../domain/activity_model.dart';

class ActivityRepository {
  const ActivityRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<ActivityPage> fetchActivity({String? cursor, int limit = 20}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/activity',
      queryParameters: {'limit': limit, 'cursor': ?cursor},
    );
    return ActivityPage.fromJson(response.data!);
  }

  Future<void> markRead(String id) => _apiClient.post<void>('/activity/$id/read');

  Future<void> markAllRead() => _apiClient.post<void>('/activity/read-all');
}
