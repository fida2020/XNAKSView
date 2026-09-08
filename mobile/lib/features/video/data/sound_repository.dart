import '../../../core/network/api_client.dart';
import '../domain/sound_model.dart';

class SoundRepository {
  const SoundRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<SoundModel>> fetchSounds({String? query}) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/sounds', queryParameters: {'query': ?query});
    return (response.data!['sounds'] as List).map((s) => SoundModel.fromJson(s as Map<String, dynamic>)).toList();
  }
}
