import '../../../core/network/api_client.dart';

class RecentSearchItem {
  const RecentSearchItem({required this.id, required this.query});

  factory RecentSearchItem.fromJson(Map<String, dynamic> json) {
    return RecentSearchItem(id: json['id'] as String, query: json['query'] as String);
  }

  final String id;
  final String query;
}

class HashtagResult {
  const HashtagResult({required this.tag, required this.postCount});

  factory HashtagResult.fromJson(Map<String, dynamic> json) {
    return HashtagResult(tag: json['tag'] as String, postCount: json['postCount'] as int);
  }

  final String tag;
  final int postCount;
}

class SearchUserResult {
  const SearchUserResult({required this.id, this.username, this.displayName, this.avatarUrl, required this.followerCount});

  factory SearchUserResult.fromJson(Map<String, dynamic> json) {
    return SearchUserResult(
      id: json['id'] as String,
      username: json['username'] as String?,
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      followerCount: json['followerCount'] as int,
    );
  }

  final String id;
  final String? username;
  final String? displayName;
  final String? avatarUrl;
  final int followerCount;

  String get displayLabel => displayName ?? (username != null ? '@$username' : 'Unknown');
}

class DiscoveryRepository {
  const DiscoveryRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<SearchUserResult>> searchUsers(String query) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/search', queryParameters: {'q': query, 'type': 'users'});
    return (response.data!['users'] as List).map((u) => SearchUserResult.fromJson(u as Map<String, dynamic>)).toList();
  }

  Future<List<HashtagResult>> searchHashtags(String query) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/search', queryParameters: {'q': query, 'type': 'hashtags'});
    return (response.data!['hashtags'] as List).map((h) => HashtagResult.fromJson(h as Map<String, dynamic>)).toList();
  }

  Future<List<RecentSearchItem>> fetchRecentSearches() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/search/recent');
    return (response.data!['recent'] as List).map((r) => RecentSearchItem.fromJson(r as Map<String, dynamic>)).toList();
  }

  Future<void> clearRecentSearches() => _apiClient.delete<void>('/search/recent');

  Future<void> deleteRecentSearch(String id) => _apiClient.delete<void>('/search/recent/$id');

  Future<List<SearchUserResult>> suggestedAccounts() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/users/suggested');
    return (response.data!['users'] as List).map((u) => SearchUserResult.fromJson(u as Map<String, dynamic>)).toList();
  }
}
