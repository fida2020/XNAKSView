import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

enum StoryMediaType { photo, video }

StoryMediaType _mediaTypeFromApi(String value) => value == 'VIDEO' ? StoryMediaType.video : StoryMediaType.photo;

class StoryModel extends Equatable {
  const StoryModel({
    required this.id,
    required this.userId,
    required this.mediaType,
    this.caption,
    required this.mediaUrl,
    required this.viewCount,
    required this.replyCount,
    this.author,
    required this.createdAt,
    required this.expiresAt,
  });

  factory StoryModel.fromJson(Map<String, dynamic> json) {
    return StoryModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      mediaType: _mediaTypeFromApi(json['mediaType'] as String),
      caption: json['caption'] as String?,
      mediaUrl: json['mediaUrl'] as String,
      viewCount: json['viewCount'] as int,
      replyCount: json['replyCount'] as int,
      author: json['author'] == null ? null : VideoAuthor.fromJson(json['author'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
    );
  }

  final String id;
  final String userId;
  final StoryMediaType mediaType;
  final String? caption;
  final String mediaUrl;
  final int viewCount;
  final int replyCount;
  final VideoAuthor? author;
  final DateTime createdAt;
  final DateTime expiresAt;

  @override
  List<Object?> get props => [id, userId, mediaType, mediaUrl, viewCount, replyCount, createdAt, expiresAt];
}

/// One author's stories, grouped client-side from the flat `/stories/feed` list.
class StoryGroup {
  StoryGroup({required this.author, required this.stories});

  final VideoAuthor? author;
  final List<StoryModel> stories;
}
