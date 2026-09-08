import '../../../core/network/api_client.dart';
import '../domain/epidemic_track_model.dart';

/// Real licensed music catalog (Epidemic Sound Partner Content API) — every
/// call here hits the real backend, which itself hits the real partner API
/// (see backend's lib/epidemicSound.ts). A 503 (SERVICE_UNAVAILABLE) means
/// this deployment genuinely has no partner key configured — surfaced to
/// the UI as a real "unavailable" state, never a fabricated catalog.
class EpidemicSoundRepository {
  const EpidemicSoundRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<EpidemicTrackPage> browse({int limit = 20, int offset = 0}) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/epidemic-sounds/browse', queryParameters: {'limit': limit, 'offset': offset});
    return EpidemicTrackPage.fromJson(response.data!);
  }

  Future<EpidemicTrackPage> search(String term, {int limit = 20, int offset = 0}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/epidemic-sounds/search',
      queryParameters: {'term': term, 'limit': limit, 'offset': offset},
    );
    return EpidemicTrackPage.fromJson(response.data!);
  }

  Future<String> fetchPreviewUrl(String trackId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/epidemic-sounds/$trackId/preview');
    return response.data!['url'] as String;
  }

  Future<List<EpidemicTrackModel>> fetchFavorites() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/epidemic-sounds/favorites');
    return (response.data!['tracks'] as List).map((t) => EpidemicTrackModel.fromJson(t as Map<String, dynamic>)).toList();
  }

  Future<List<EpidemicTrackModel>> fetchRecent() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/epidemic-sounds/recent');
    return (response.data!['tracks'] as List).map((t) => EpidemicTrackModel.fromJson(t as Map<String, dynamic>)).toList();
  }

  Future<void> favorite(EpidemicTrackModel track) => _apiClient.post<void>(
        '/epidemic-sounds/${track.id}/favorite',
        data: {'trackTitle': track.title, 'trackArtist': track.artist},
      );

  Future<void> unfavorite(String trackId) => _apiClient.delete<void>('/epidemic-sounds/$trackId/favorite');
}
