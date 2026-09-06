import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

enum ActivityType { like, comment, commentLike, commentReply, follow, mention, repost, unknown }

ActivityType _activityTypeFromApi(String value) {
  switch (value) {
    case 'LIKE':
      return ActivityType.like;
    case 'COMMENT':
      return ActivityType.comment;
    case 'COMMENT_LIKE':
      return ActivityType.commentLike;
    case 'COMMENT_REPLY':
      return ActivityType.commentReply;
    case 'FOLLOW':
      return ActivityType.follow;
    case 'MENTION':
      return ActivityType.mention;
    case 'REPOST':
      return ActivityType.repost;
    default:
      return ActivityType.unknown;
  }
}

class ActivityItem extends Equatable {
  const ActivityItem({
    required this.id,
    required this.type,
    this.actor,
    this.videoId,
    this.commentId,
    required this.read,
    required this.createdAt,
  });

  factory ActivityItem.fromJson(Map<String, dynamic> json) {
    return ActivityItem(
      id: json['id'] as String,
      type: _activityTypeFromApi(json['type'] as String),
      actor: json['actor'] == null ? null : VideoAuthor.fromJson(json['actor'] as Map<String, dynamic>),
      videoId: json['videoId'] as String?,
      commentId: json['commentId'] as String?,
      read: json['read'] as bool,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final ActivityType type;
  final VideoAuthor? actor;
  final String? videoId;
  final String? commentId;
  final bool read;
  final DateTime createdAt;

  String get message {
    final name = actor?.displayLabel ?? 'Someone';
    switch (type) {
      case ActivityType.like:
        return '$name liked your video';
      case ActivityType.comment:
        return '$name commented on your video';
      case ActivityType.commentLike:
        return '$name liked your comment';
      case ActivityType.commentReply:
        return '$name replied to your comment';
      case ActivityType.follow:
        return '$name started following you';
      case ActivityType.mention:
        return '$name mentioned you';
      case ActivityType.repost:
        return '$name reposted your video';
      case ActivityType.unknown:
        return '$name interacted with your content';
    }
  }

  ActivityItem copyWith({bool? read}) {
    return ActivityItem(
      id: id,
      type: type,
      actor: actor,
      videoId: videoId,
      commentId: commentId,
      read: read ?? this.read,
      createdAt: createdAt,
    );
  }

  @override
  List<Object?> get props => [id, type, actor, videoId, commentId, read, createdAt];
}

class ActivityPage extends Equatable {
  const ActivityPage({required this.items, this.nextCursor});

  factory ActivityPage.fromJson(Map<String, dynamic> json) {
    return ActivityPage(
      items: (json['activity'] as List).map((item) => ActivityItem.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<ActivityItem> items;
  final String? nextCursor;

  @override
  List<Object?> get props => [items, nextCursor];
}
