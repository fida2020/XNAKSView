import 'package:equatable/equatable.dart';

enum VideoStatus { processing, ready, failed, deleted, unknown }

VideoStatus _videoStatusFromApi(String value) {
  switch (value) {
    case 'PROCESSING':
      return VideoStatus.processing;
    case 'READY':
      return VideoStatus.ready;
    case 'FAILED':
      return VideoStatus.failed;
    case 'DELETED':
      return VideoStatus.deleted;
    default:
      return VideoStatus.unknown;
  }
}

enum VideoVisibility { public, private }

VideoVisibility _videoVisibilityFromApi(String value) => value == 'PRIVATE' ? VideoVisibility.private : VideoVisibility.public;

class VideoAuthor extends Equatable {
  const VideoAuthor({required this.id, this.username, this.displayName, this.avatarUrl});

  factory VideoAuthor.fromJson(Map<String, dynamic> json) {
    return VideoAuthor(
      id: json['id'] as String,
      username: json['username'] as String?,
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
    );
  }

  final String id;
  final String? username;
  final String? displayName;
  final String? avatarUrl;

  String get displayLabel => displayName ?? (username != null ? '@$username' : 'Unknown creator');

  @override
  List<Object?> get props => [id, username, displayName, avatarUrl];
}

class VideoModel extends Equatable {
  const VideoModel({
    required this.id,
    required this.userId,
    this.caption,
    required this.status,
    required this.visibility,
    this.processingError,
    this.playbackUrl,
    this.thumbnailUrl,
    this.durationMs,
    this.width,
    this.height,
    required this.likeCount,
    required this.commentCount,
    required this.viewCount,
    required this.shareCount,
    this.likedByMe,
    this.isFollowedByMe,
    this.repostedByMe = false,
    this.favoritedByMe = false,
    this.allowDuet = true,
    this.allowStitch = true,
    this.allowDownload = true,
    this.allowComments = true,
    this.allowGifts = true,
    this.addYoursPrompt,
    this.soundId,
    this.author,
    required this.createdAt,
  });

  factory VideoModel.fromJson(Map<String, dynamic> json) {
    return VideoModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      caption: json['caption'] as String?,
      status: _videoStatusFromApi(json['status'] as String),
      visibility: _videoVisibilityFromApi(json['visibility'] as String),
      processingError: json['processingError'] as String?,
      playbackUrl: json['playbackUrl'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      durationMs: json['durationMs'] as int?,
      width: json['width'] as int?,
      height: json['height'] as int?,
      likeCount: json['likeCount'] as int,
      commentCount: json['commentCount'] as int,
      viewCount: json['viewCount'] as int,
      shareCount: json['shareCount'] as int,
      likedByMe: json['likedByMe'] as bool?,
      isFollowedByMe: json['isFollowedByMe'] as bool?,
      repostedByMe: json['repostedByMe'] as bool? ?? false,
      favoritedByMe: json['favoritedByMe'] as bool? ?? false,
      allowDuet: json['allowDuet'] as bool? ?? true,
      allowStitch: json['allowStitch'] as bool? ?? true,
      allowDownload: json['allowDownload'] as bool? ?? true,
      allowComments: json['allowComments'] as bool? ?? true,
      allowGifts: json['allowGifts'] as bool? ?? true,
      addYoursPrompt: json['addYoursPrompt'] as String?,
      soundId: json['soundId'] as String?,
      author: json['author'] == null ? null : VideoAuthor.fromJson(json['author'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final String? caption;
  final VideoStatus status;
  final VideoVisibility visibility;
  final String? processingError;
  final String? playbackUrl;
  final String? thumbnailUrl;
  final int? durationMs;
  final int? width;
  final int? height;
  final int likeCount;
  final int commentCount;
  final int viewCount;
  final int shareCount;
  final bool? likedByMe;
  final bool? isFollowedByMe;
  final bool repostedByMe;
  final bool favoritedByMe;
  final bool allowDuet;
  final bool allowStitch;
  final bool allowDownload;
  final bool allowComments;
  final bool allowGifts;
  final String? addYoursPrompt;
  final String? soundId;
  final VideoAuthor? author;
  final DateTime createdAt;

  VideoModel copyWith({
    int? likeCount,
    int? commentCount,
    int? shareCount,
    bool? likedByMe,
    bool? isFollowedByMe,
    bool? repostedByMe,
    bool? favoritedByMe,
  }) {
    return VideoModel(
      id: id,
      userId: userId,
      caption: caption,
      status: status,
      visibility: visibility,
      processingError: processingError,
      playbackUrl: playbackUrl,
      thumbnailUrl: thumbnailUrl,
      durationMs: durationMs,
      width: width,
      height: height,
      likeCount: likeCount ?? this.likeCount,
      commentCount: commentCount ?? this.commentCount,
      viewCount: viewCount,
      shareCount: shareCount ?? this.shareCount,
      likedByMe: likedByMe ?? this.likedByMe,
      isFollowedByMe: isFollowedByMe ?? this.isFollowedByMe,
      repostedByMe: repostedByMe ?? this.repostedByMe,
      favoritedByMe: favoritedByMe ?? this.favoritedByMe,
      allowDuet: allowDuet,
      allowStitch: allowStitch,
      allowDownload: allowDownload,
      allowComments: allowComments,
      allowGifts: allowGifts,
      addYoursPrompt: addYoursPrompt,
      soundId: soundId,
      author: author,
      createdAt: createdAt,
    );
  }

  @override
  List<Object?> get props => [
        id,
        userId,
        caption,
        status,
        visibility,
        playbackUrl,
        thumbnailUrl,
        likeCount,
        commentCount,
        viewCount,
        shareCount,
        likedByMe,
        isFollowedByMe,
      ];
}

class FeedPage extends Equatable {
  const FeedPage({required this.videos, this.nextCursor});

  factory FeedPage.fromJson(Map<String, dynamic> json) {
    return FeedPage(
      videos: (json['videos'] as List).map((item) => VideoModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<VideoModel> videos;
  final String? nextCursor;

  @override
  List<Object?> get props => [videos, nextCursor];
}
