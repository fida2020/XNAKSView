import '../../../core/network/api_client.dart';

class PlaylistEligibility {
  const PlaylistEligibility({required this.eligible, required this.followerCount, required this.requiredFollowers});

  factory PlaylistEligibility.fromJson(Map<String, dynamic> json) {
    return PlaylistEligibility(
      eligible: json['eligible'] as bool,
      followerCount: json['followerCount'] as int,
      requiredFollowers: json['requiredFollowers'] as int,
    );
  }

  final bool eligible;
  final int followerCount;
  final int requiredFollowers;
}

class PlaylistModel {
  const PlaylistModel({
    required this.id,
    required this.userId,
    required this.name,
    this.description,
    required this.viewCount,
    required this.createdAt,
  });

  factory PlaylistModel.fromJson(Map<String, dynamic> json) {
    return PlaylistModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      viewCount: json['viewCount'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final String name;
  final String? description;
  final int viewCount;
  final DateTime createdAt;
}

class PlaylistDetail extends PlaylistModel {
  const PlaylistDetail({
    required super.id,
    required super.userId,
    required super.name,
    super.description,
    required super.viewCount,
    required super.createdAt,
    required this.videoIds,
  });

  factory PlaylistDetail.fromJson(Map<String, dynamic> json) {
    return PlaylistDetail(
      id: json['id'] as String,
      userId: json['userId'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      viewCount: json['viewCount'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
      videoIds: (json['videos'] as List).map((v) => v['id'] as String).toList(),
    );
  }

  final List<String> videoIds;
}

class PlaylistsRepository {
  const PlaylistsRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<PlaylistEligibility> fetchEligibility() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/playlists/eligibility');
    return PlaylistEligibility.fromJson(response.data!);
  }

  Future<List<PlaylistModel>> fetchUserPlaylists(String userId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/$userId/playlists');
    return (response.data!['playlists'] as List).map((p) => PlaylistModel.fromJson(p as Map<String, dynamic>)).toList();
  }

  Future<PlaylistModel> createPlaylist({required String name, String? description}) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/playlists',
      data: {'name': name, if (description != null && description.isNotEmpty) 'description': description},
    );
    return PlaylistModel.fromJson(response.data!);
  }

  Future<PlaylistDetail> fetchPlaylist(String playlistId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/playlists/$playlistId');
    return PlaylistDetail.fromJson(response.data!);
  }

  Future<void> deletePlaylist(String playlistId) => _apiClient.delete<void>('/playlists/$playlistId');

  Future<void> addVideo(String playlistId, String videoId) =>
      _apiClient.post<void>('/playlists/$playlistId/videos', data: {'videoId': videoId});

  Future<void> removeVideo(String playlistId, String videoId) => _apiClient.delete<void>('/playlists/$playlistId/videos/$videoId');
}
