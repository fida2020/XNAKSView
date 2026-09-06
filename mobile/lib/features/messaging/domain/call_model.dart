import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

enum CallStatus { ringing, accepted, declined, busy, missed, ended, cancelled, failed, unknown }
enum CallDirection { incoming, outgoing, unknown }

CallStatus _statusFromApi(String value) {
  switch (value) {
    case 'RINGING':
      return CallStatus.ringing;
    case 'ACCEPTED':
      return CallStatus.accepted;
    case 'DECLINED':
      return CallStatus.declined;
    case 'BUSY':
      return CallStatus.busy;
    case 'MISSED':
      return CallStatus.missed;
    case 'ENDED':
      return CallStatus.ended;
    case 'CANCELLED':
      return CallStatus.cancelled;
    case 'FAILED':
      return CallStatus.failed;
    default:
      return CallStatus.unknown;
  }
}

class CallModel extends Equatable {
  const CallModel({
    required this.id,
    required this.callerId,
    required this.calleeId,
    required this.status,
    required this.startedAt,
    this.answeredAt,
    this.endedAt,
    this.durationSeconds,
    this.failureReason,
    this.otherUser,
    this.direction = CallDirection.unknown,
  });

  factory CallModel.fromJson(Map<String, dynamic> json) {
    return CallModel(
      id: json['id'] as String,
      callerId: json['callerId'] as String,
      calleeId: json['calleeId'] as String,
      status: _statusFromApi(json['status'] as String),
      startedAt: DateTime.parse(json['startedAt'] as String),
      answeredAt: json['answeredAt'] == null ? null : DateTime.parse(json['answeredAt'] as String),
      endedAt: json['endedAt'] == null ? null : DateTime.parse(json['endedAt'] as String),
      durationSeconds: json['durationSeconds'] as int?,
      failureReason: json['failureReason'] as String?,
      otherUser: json['otherUser'] == null ? null : VideoAuthor.fromJson(json['otherUser'] as Map<String, dynamic>),
      direction: json['direction'] == 'INCOMING'
          ? CallDirection.incoming
          : json['direction'] == 'OUTGOING'
              ? CallDirection.outgoing
              : CallDirection.unknown,
    );
  }

  final String id;
  final String callerId;
  final String calleeId;
  final CallStatus status;
  final DateTime startedAt;
  final DateTime? answeredAt;
  final DateTime? endedAt;
  final int? durationSeconds;
  final String? failureReason;
  final VideoAuthor? otherUser;
  final CallDirection direction;

  @override
  List<Object?> get props => [id, callerId, calleeId, status, startedAt];
}

class CallConnectionInfo extends Equatable {
  const CallConnectionInfo({required this.call, required this.token, required this.wsUrl});

  factory CallConnectionInfo.fromJson(Map<String, dynamic> json) {
    return CallConnectionInfo(
      call: CallModel.fromJson(json['call'] as Map<String, dynamic>),
      token: json['token'] as String,
      wsUrl: json['wsUrl'] as String,
    );
  }

  final CallModel call;
  final String token;
  final String wsUrl;

  @override
  List<Object?> get props => [call, token, wsUrl];
}

class CallHistoryPage extends Equatable {
  const CallHistoryPage({required this.calls, this.nextCursor});

  factory CallHistoryPage.fromJson(Map<String, dynamic> json) {
    return CallHistoryPage(
      calls: (json['calls'] as List).map((item) => CallModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<CallModel> calls;
  final String? nextCursor;

  @override
  List<Object?> get props => [calls, nextCursor];
}
