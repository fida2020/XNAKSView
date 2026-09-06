import 'package:equatable/equatable.dart';

enum MessageType { text, voice, unknown }

MessageType _typeFromApi(String value) {
  switch (value) {
    case 'TEXT':
      return MessageType.text;
    case 'VOICE':
      return MessageType.voice;
    default:
      return MessageType.unknown;
  }
}

class MessageReceipt extends Equatable {
  const MessageReceipt({required this.userId, this.deliveredAt, this.readAt});

  factory MessageReceipt.fromJson(Map<String, dynamic> json) {
    return MessageReceipt(
      userId: json['userId'] as String,
      deliveredAt: json['deliveredAt'] == null ? null : DateTime.parse(json['deliveredAt'] as String),
      readAt: json['readAt'] == null ? null : DateTime.parse(json['readAt'] as String),
    );
  }

  final String userId;
  final DateTime? deliveredAt;
  final DateTime? readAt;

  @override
  List<Object?> get props => [userId, deliveredAt, readAt];
}

class MessageModel extends Equatable {
  const MessageModel({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.type,
    this.text,
    this.voiceUrl,
    this.voiceDurationMs,
    required this.clientMessageId,
    required this.deleted,
    required this.createdAt,
    this.receipts = const [],
  });

  factory MessageModel.fromJson(Map<String, dynamic> json) {
    return MessageModel(
      id: json['id'] as String,
      conversationId: json['conversationId'] as String,
      senderId: json['senderId'] as String,
      type: _typeFromApi(json['type'] as String),
      text: json['text'] as String?,
      voiceUrl: json['voiceUrl'] as String?,
      voiceDurationMs: json['voiceDurationMs'] as int?,
      clientMessageId: json['clientMessageId'] as String,
      deleted: json['deleted'] as bool,
      createdAt: DateTime.parse(json['createdAt'] as String),
      receipts: json['receipts'] == null
          ? const []
          : (json['receipts'] as List).map((item) => MessageReceipt.fromJson(item as Map<String, dynamic>)).toList(),
    );
  }

  final String id;
  final String conversationId;
  final String senderId;
  final MessageType type;
  final String? text;
  final String? voiceUrl;
  final int? voiceDurationMs;
  final String clientMessageId;
  final bool deleted;
  final DateTime createdAt;
  final List<MessageReceipt> receipts;

  bool isReadBy(String userId) => receipts.any((r) => r.userId == userId && r.readAt != null);

  @override
  List<Object?> get props => [id, conversationId, senderId, type, text, deleted, createdAt];
}

class MessagePage extends Equatable {
  const MessagePage({required this.messages, this.nextCursor});

  factory MessagePage.fromJson(Map<String, dynamic> json) {
    return MessagePage(
      messages: (json['messages'] as List).map((item) => MessageModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<MessageModel> messages;
  final String? nextCursor;

  @override
  List<Object?> get props => [messages, nextCursor];
}
