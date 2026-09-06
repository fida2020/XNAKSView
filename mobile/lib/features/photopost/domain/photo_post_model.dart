import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

class PhotoItem extends Equatable {
  const PhotoItem({required this.id, required this.url});

  factory PhotoItem.fromJson(Map<String, dynamic> json) {
    return PhotoItem(id: json['id'] as String, url: json['url'] as String);
  }

  final String id;
  final String url;

  @override
  List<Object?> get props => [id, url];
}

class PhotoPostModel extends Equatable {
  const PhotoPostModel({
    required this.id,
    required this.userId,
    this.caption,
    required this.visibility,
    required this.likeCount,
    required this.commentCount,
    this.likedByMe = false,
    this.photos = const [],
    this.author,
    required this.createdAt,
  });

  factory PhotoPostModel.fromJson(Map<String, dynamic> json) {
    return PhotoPostModel(
      id: json['id'] as String,
      userId: json['userId'] as String,
      caption: json['caption'] as String?,
      visibility: json['visibility'] as String? ?? 'PUBLIC',
      likeCount: json['likeCount'] as int? ?? 0,
      commentCount: json['commentCount'] as int? ?? 0,
      likedByMe: json['likedByMe'] as bool? ?? false,
      photos: json['photos'] == null
          ? const []
          : (json['photos'] as List).map((p) => PhotoItem.fromJson(p as Map<String, dynamic>)).toList(),
      author: json['author'] == null ? null : VideoAuthor.fromJson(json['author'] as Map<String, dynamic>),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final String? caption;
  final String visibility;
  final int likeCount;
  final int commentCount;
  final bool likedByMe;
  final List<PhotoItem> photos;
  final VideoAuthor? author;
  final DateTime createdAt;

  @override
  List<Object?> get props => [id, userId, caption, likeCount, commentCount, likedByMe, photos];
}
