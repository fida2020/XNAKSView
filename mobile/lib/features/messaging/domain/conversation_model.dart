import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

enum ConversationRequestStatus { pending, accepted, unknown }

ConversationRequestStatus _statusFromApi(String value) {
  switch (value) {
    case 'PENDING':
      return ConversationRequestStatus.pending;
    case 'ACCEPTED':
      return ConversationRequestStatus.accepted;
    default:
      return ConversationRequestStatus.unknown;
  }
}

class ConversationPresence extends Equatable {
  const ConversationPresence({required this.online, this.lastActiveAt});

  factory ConversationPresence.fromJson(Map<String, dynamic> json) {
    return ConversationPresence(
      online: json['online'] as bool,
      lastActiveAt: json['lastActiveAt'] == null ? null : DateTime.parse(json['lastActiveAt'] as String),
    );
  }

  final bool online;
  final DateTime? lastActiveAt;

  @override
  List<Object?> get props => [online, lastActiveAt];
}

class ConversationModel extends Equatable {
  const ConversationModel({
    required this.id,
    required this.status,
    this.otherUser,
    required this.unreadCount,
    required this.muted,
    required this.pinned,
    this.lastMessageAt,
    this.lastMessagePreview,
    required this.createdAt,
    this.presence,
  });

  factory ConversationModel.fromJson(Map<String, dynamic> json) {
    return ConversationModel(
      id: json['id'] as String,
      status: _statusFromApi(json['status'] as String),
      otherUser: json['otherUser'] == null ? null : VideoAuthor.fromJson(json['otherUser'] as Map<String, dynamic>),
      unreadCount: json['unreadCount'] as int,
      muted: json['muted'] as bool,
      pinned: json['pinned'] as bool,
      lastMessageAt: json['lastMessageAt'] == null ? null : DateTime.parse(json['lastMessageAt'] as String),
      lastMessagePreview: json['lastMessagePreview'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      presence: json['presence'] == null ? null : ConversationPresence.fromJson(json['presence'] as Map<String, dynamic>),
    );
  }

  final String id;
  final ConversationRequestStatus status;
  final VideoAuthor? otherUser;
  final int unreadCount;
  final bool muted;
  final bool pinned;
  final DateTime? lastMessageAt;
  final String? lastMessagePreview;
  final DateTime createdAt;
  final ConversationPresence? presence;

  ConversationModel copyWith({
    ConversationRequestStatus? status,
    int? unreadCount,
    bool? muted,
    bool? pinned,
    ConversationPresence? presence,
  }) {
    return ConversationModel(
      id: id,
      status: status ?? this.status,
      otherUser: otherUser,
      unreadCount: unreadCount ?? this.unreadCount,
      muted: muted ?? this.muted,
      pinned: pinned ?? this.pinned,
      lastMessageAt: lastMessageAt,
      lastMessagePreview: lastMessagePreview,
      createdAt: createdAt,
      presence: presence ?? this.presence,
    );
  }

  @override
  List<Object?> get props => [id, status, unreadCount, muted, pinned, lastMessageAt];
}

class ConversationListPage extends Equatable {
  const ConversationListPage({required this.pinned, required this.conversations, this.nextCursor});

  factory ConversationListPage.fromJson(Map<String, dynamic> json) {
    return ConversationListPage(
      pinned: (json['pinned'] as List).map((item) => ConversationModel.fromJson(item as Map<String, dynamic>)).toList(),
      conversations:
          (json['conversations'] as List).map((item) => ConversationModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<ConversationModel> pinned;
  final List<ConversationModel> conversations;
  final String? nextCursor;

  @override
  List<Object?> get props => [pinned, conversations, nextCursor];
}
