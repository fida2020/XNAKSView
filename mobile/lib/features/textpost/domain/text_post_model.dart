import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

class TextPostModel extends Equatable {
  const TextPostModel({
    required this.id,
    required this.userId,
    required this.text,
    this.backgroundStyle,
    required this.likeCount,
    required this.commentCount,
    this.likedByMe = false,
    this.author,
    required this.createdAt,
  });

  factory TextPostModel.fromJson(Map<String, dynamic> json) {
    return TextPostModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      text: json['text'] as String,
      backgroundStyle: json['backgroundStyle'] as String?,
      likeCount: json['likeCount'] as int,
      commentCount: json['commentCount'] as int,
      likedByMe: json['likedByMe'] as bool? ?? false,
      author: json['author'] == null ? null : VideoAuthor.fromJson(json['author'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final String text;
  final String? backgroundStyle;
  final int likeCount;
  final int commentCount;
  final bool likedByMe;
  final VideoAuthor? author;
  final DateTime createdAt;

  @override
  List<Object?> get props => [id, userId, text, likeCount, commentCount, likedByMe];
}
