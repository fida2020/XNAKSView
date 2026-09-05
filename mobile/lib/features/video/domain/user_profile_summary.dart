import 'package:equatable/equatable.dart';

class UserProfileSummary extends Equatable {
  const UserProfileSummary({
    required this.id,
    this.username,
    this.displayName,
    this.bio,
    this.avatarUrl,
    required this.followerCount,
    required this.followingCount,
    this.isFollowedByMe,
    required this.isSelf,
  });

  factory UserProfileSummary.fromJson(Map<String, dynamic> json) {
    return UserProfileSummary(
      id: json['id'] as String,
      username: json['username'] as String?,
      displayName: json['displayName'] as String?,
      bio: json['bio'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      followerCount: json['followerCount'] as int,
      followingCount: json['followingCount'] as int,
      isFollowedByMe: json['isFollowedByMe'] as bool?,
      isSelf: json['isSelf'] as bool,
    );
  }

  final String id;
  final String? username;
  final String? displayName;
  final String? bio;
  final String? avatarUrl;
  final int followerCount;
  final int followingCount;
  final bool? isFollowedByMe;
  final bool isSelf;

  String get displayLabel => displayName ?? (username != null ? '@$username' : 'Unknown');

  @override
  List<Object?> get props => [id, username, displayName, followerCount, followingCount, isFollowedByMe];
}
