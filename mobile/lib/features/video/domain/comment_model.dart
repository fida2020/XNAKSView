import 'package:equatable/equatable.dart';

class CommentModel extends Equatable {
  const CommentModel({
    required this.id,
    required this.videoId,
    required this.userId,
    this.username,
    this.displayName,
    this.avatarUrl,
    required this.text,
    required this.createdAt,
  });

  factory CommentModel.fromJson(Map<String, dynamic> json) {
    return CommentModel(
      id: json['id'] as String,
      videoId: json['videoId'] as String,
      userId: json['userId'] as String,
      username: json['username'] as String?,
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      text: json['text'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String videoId;
  final String userId;
  final String? username;
  final String? displayName;
  final String? avatarUrl;
  final String text;
  final DateTime createdAt;

  String get authorLabel => displayName ?? (username != null ? '@$username' : 'Unknown');

  @override
  List<Object?> get props => [id, videoId, userId, text, createdAt];
}

class CommentsPage extends Equatable {
  const CommentsPage({required this.comments, this.nextCursor});

  factory CommentsPage.fromJson(Map<String, dynamic> json) {
    return CommentsPage(
      comments: (json['comments'] as List).map((item) => CommentModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<CommentModel> comments;
  final String? nextCursor;

  @override
  List<Object?> get props => [comments, nextCursor];
}
