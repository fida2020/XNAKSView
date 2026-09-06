import 'package:equatable/equatable.dart';

class CommentModel extends Equatable {
  const CommentModel({
    required this.id,
    required this.videoId,
    required this.userId,
    this.parentId,
    this.username,
    this.displayName,
    this.avatarUrl,
    required this.text,
    this.likeCount = 0,
    this.replyCount = 0,
    this.isPinned = false,
    this.likedByMe = false,
    required this.createdAt,
  });

  factory CommentModel.fromJson(Map<String, dynamic> json) {
    return CommentModel(
      id: json['id'] as String,
      videoId: json['videoId'] as String,
      userId: json['userId'] as String,
      parentId: json['parentId'] as String?,
      username: json['username'] as String?,
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      text: json['text'] as String,
      likeCount: json['likeCount'] as int? ?? 0,
      replyCount: json['replyCount'] as int? ?? 0,
      isPinned: json['isPinned'] as bool? ?? false,
      likedByMe: json['likedByMe'] as bool? ?? false,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String videoId;
  final String userId;
  final String? parentId;
  final String? username;
  final String? displayName;
  final String? avatarUrl;
  final String text;
  final int likeCount;
  final int replyCount;
  final bool isPinned;
  final bool likedByMe;
  final DateTime createdAt;

  String get authorLabel => displayName ?? (username != null ? '@$username' : 'Unknown');

  CommentModel copyWith({int? likeCount, bool? likedByMe, bool? isPinned, int? replyCount}) {
    return CommentModel(
      id: id,
      videoId: videoId,
      userId: userId,
      parentId: parentId,
      username: username,
      displayName: displayName,
      avatarUrl: avatarUrl,
      text: text,
      likeCount: likeCount ?? this.likeCount,
      replyCount: replyCount ?? this.replyCount,
      isPinned: isPinned ?? this.isPinned,
      likedByMe: likedByMe ?? this.likedByMe,
      createdAt: createdAt,
    );
  }

  @override
  List<Object?> get props => [id, videoId, userId, parentId, text, likeCount, replyCount, isPinned, likedByMe, createdAt];
}

class CommentsPage extends Equatable {
  const CommentsPage({required this.comments, this.pinned, this.nextCursor});

  factory CommentsPage.fromJson(Map<String, dynamic> json) {
    return CommentsPage(
      comments: (json['comments'] as List).map((item) => CommentModel.fromJson(item as Map<String, dynamic>)).toList(),
      pinned: json['pinned'] == null ? null : CommentModel.fromJson(json['pinned'] as Map<String, dynamic>),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<CommentModel> comments;
  final CommentModel? pinned;
  final String? nextCursor;

  @override
  List<Object?> get props => [comments, pinned, nextCursor];
}
