import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

enum LiveStatus { live, ended, unknown }

LiveStatus _liveStatusFromApi(String value) {
  switch (value) {
    case 'LIVE':
      return LiveStatus.live;
    case 'ENDED':
      return LiveStatus.ended;
    default:
      return LiveStatus.unknown;
  }
}

class LiveSessionModel extends Equatable {
  const LiveSessionModel({
    required this.id,
    required this.hostId,
    this.host,
    required this.title,
    this.category,
    this.thumbnailUrl,
    required this.status,
    required this.viewerCount,
    required this.peakViewerCount,
    this.isOwnSession,
    required this.startedAt,
    this.endedAt,
    this.goalEnabled = false,
    this.goalTitle,
    this.goalTargetCoins,
    this.goalProgressCoins = 0,
    this.isVoiceOnly = false,
  });

  factory LiveSessionModel.fromJson(Map<String, dynamic> json) {
    return LiveSessionModel(
      id: json['id'] as String,
      hostId: json['hostId'] as String,
      host: json['host'] == null ? null : VideoAuthor.fromJson(json['host'] as Map<String, dynamic>),
      title: json['title'] as String,
      category: json['category'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      status: _liveStatusFromApi(json['status'] as String),
      viewerCount: json['viewerCount'] as int,
      peakViewerCount: json['peakViewerCount'] as int,
      isOwnSession: json['isOwnSession'] as bool?,
      startedAt: DateTime.parse(json['startedAt'] as String),
      endedAt: json['endedAt'] == null ? null : DateTime.parse(json['endedAt'] as String),
      goalEnabled: json['goalEnabled'] as bool? ?? false,
      goalTitle: json['goalTitle'] as String?,
      goalTargetCoins: json['goalTargetCoins'] as int?,
      goalProgressCoins: json['goalProgressCoins'] as int? ?? 0,
      isVoiceOnly: json['isVoiceOnly'] as bool? ?? false,
    );
  }

  final String id;
  final String hostId;
  final VideoAuthor? host;
  final String title;
  final String? category;
  final String? thumbnailUrl;
  final LiveStatus status;
  final int viewerCount;
  final int peakViewerCount;
  final bool? isOwnSession;
  final DateTime startedAt;
  final DateTime? endedAt;
  final bool goalEnabled;
  final String? goalTitle;
  final int? goalTargetCoins;
  final int goalProgressCoins;
  final bool isVoiceOnly;

  LiveSessionModel copyWith({int? viewerCount, LiveStatus? status, DateTime? endedAt, int? goalProgressCoins}) {
    return LiveSessionModel(
      id: id,
      hostId: hostId,
      host: host,
      title: title,
      category: category,
      thumbnailUrl: thumbnailUrl,
      status: status ?? this.status,
      goalEnabled: goalEnabled,
      goalTitle: goalTitle,
      goalTargetCoins: goalTargetCoins,
      goalProgressCoins: goalProgressCoins ?? this.goalProgressCoins,
      isVoiceOnly: isVoiceOnly,
      viewerCount: viewerCount ?? this.viewerCount,
      peakViewerCount: peakViewerCount,
      isOwnSession: isOwnSession,
      startedAt: startedAt,
      endedAt: endedAt ?? this.endedAt,
    );
  }

  @override
  List<Object?> get props => [id, hostId, title, status, viewerCount];
}

class LiveConnectionInfo extends Equatable {
  const LiveConnectionInfo({required this.token, required this.wsUrl});

  factory LiveConnectionInfo.fromJson(Map<String, dynamic> json) {
    return LiveConnectionInfo(token: json['token'] as String, wsUrl: json['wsUrl'] as String);
  }

  final String token;
  final String wsUrl;

  @override
  List<Object?> get props => [token, wsUrl];
}

class LiveSessionPage extends Equatable {
  const LiveSessionPage({required this.liveSessions, this.nextCursor});

  factory LiveSessionPage.fromJson(Map<String, dynamic> json) {
    return LiveSessionPage(
      liveSessions:
          (json['liveSessions'] as List).map((item) => LiveSessionModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<LiveSessionModel> liveSessions;
  final String? nextCursor;

  @override
  List<Object?> get props => [liveSessions, nextCursor];
}
