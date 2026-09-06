import 'package:equatable/equatable.dart';

class LiveChatMessageModel extends Equatable {
  const LiveChatMessageModel({
    required this.id,
    required this.liveSessionId,
    required this.userId,
    this.username,
    this.displayName,
    required this.text,
    required this.createdAt,
  });

  factory LiveChatMessageModel.fromJson(Map<String, dynamic> json) {
    return LiveChatMessageModel(
      id: json['id'] as String,
      liveSessionId: json['liveSessionId'] as String,
      userId: json['userId'] as String,
      username: json['username'] as String?,
      displayName: json['displayName'] as String?,
      text: json['text'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String liveSessionId;
  final String userId;
  final String? username;
  final String? displayName;
  final String text;
  final DateTime createdAt;

  String get authorLabel => displayName ?? (username != null ? '@$username' : 'Unknown');

  @override
  List<Object?> get props => [id, liveSessionId, userId, text, createdAt];
}
