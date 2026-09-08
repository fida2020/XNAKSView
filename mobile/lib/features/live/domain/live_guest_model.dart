import 'package:equatable/equatable.dart';

import '../../video/domain/video_model.dart' show VideoAuthor;

enum LiveGuestRole { coHost, guest }

LiveGuestRole _roleFromApi(String value) => value == 'CO_HOST' ? LiveGuestRole.coHost : LiveGuestRole.guest;

enum LiveGuestStatus { invited, active, declined, removed, left, unknown }

LiveGuestStatus _statusFromApi(String value) {
  switch (value) {
    case 'INVITED':
      return LiveGuestStatus.invited;
    case 'ACTIVE':
      return LiveGuestStatus.active;
    case 'DECLINED':
      return LiveGuestStatus.declined;
    case 'REMOVED':
      return LiveGuestStatus.removed;
    case 'LEFT':
      return LiveGuestStatus.left;
    default:
      return LiveGuestStatus.unknown;
  }
}

/// A co-host/guest seat in a LIVE session — used by the Gift feature (Step 7)
/// to know who can actually be targeted with a Gift right now. Only
/// [LiveGuestStatus.active] guests are real Gift recipients; the server
/// independently re-verifies this on every send regardless of what this
/// list showed a moment ago (a guest can leave/be removed at any time).
class LiveGuestModel extends Equatable {
  const LiveGuestModel({
    required this.slotId,
    required this.userId,
    required this.role,
    required this.status,
    this.user,
  });

  factory LiveGuestModel.fromJson(Map<String, dynamic> json) {
    return LiveGuestModel(
      slotId: json['id'] as String,
      userId: json['userId'] as String,
      role: _roleFromApi(json['role'] as String),
      status: _statusFromApi(json['status'] as String),
      user: json['user'] == null ? null : VideoAuthor.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  final String slotId;
  final String userId;
  final LiveGuestRole role;
  final LiveGuestStatus status;
  final VideoAuthor? user;

  String get displayLabel => user?.displayLabel ?? 'Guest';

  @override
  List<Object?> get props => [slotId, userId, role, status];
}
