import 'package:equatable/equatable.dart';

enum GiftCategory { appreciation, premium, celebration, live, special, unknown }

GiftCategory _categoryFromApi(String value) {
  switch (value) {
    case 'APPRECIATION':
      return GiftCategory.appreciation;
    case 'PREMIUM':
      return GiftCategory.premium;
    case 'CELEBRATION':
      return GiftCategory.celebration;
    case 'LIVE':
      return GiftCategory.live;
    case 'SPECIAL':
      return GiftCategory.special;
    default:
      return GiftCategory.unknown;
  }
}

/// A catalog Gift — `coinCost` and every other value here comes from the
/// backend's `Gift` table; the client never hardcodes or recomputes a
/// price. There is no asset-serving pipeline yet for `thumbnailKey`/
/// `animationAssetKey` (no route resolves them to a fetchable URL), so the
/// presentation layer renders an original, programmatic XNAKView visual per
/// category instead of an uploaded image — see `gift_visuals.dart`.
class GiftModel extends Equatable {
  const GiftModel({
    required this.id,
    required this.name,
    required this.slug,
    required this.coinCost,
    required this.category,
    required this.maxQuantityPerSend,
    required this.sortOrder,
  });

  factory GiftModel.fromJson(Map<String, dynamic> json) {
    return GiftModel(
      id: json['id'] as String,
      name: json['name'] as String,
      slug: json['slug'] as String,
      coinCost: json['coinCost'] as int,
      category: _categoryFromApi(json['category'] as String),
      maxQuantityPerSend: json['maxQuantityPerSend'] as int,
      sortOrder: json['sortOrder'] as int,
    );
  }

  final String id;
  final String name;
  final String slug;
  final int coinCost;
  final GiftCategory category;
  final int maxQuantityPerSend;
  final int sortOrder;

  @override
  List<Object?> get props => [id, name, slug, coinCost, category, maxQuantityPerSend];
}

/// Mirrors the backend's `GiftTarget` union (`lib/giftService.ts`) — exactly
/// one of these four shapes is sent with a Gift, and the server resolves
/// the actual recipient from it. The client never sends a recipient id
/// directly; `targetParticipantId` on the LIVE case is only ever a
/// *request*, independently re-validated server-side against real LIVE
/// participant state.
sealed class GiftTarget {
  const GiftTarget();

  Map<String, dynamic> toJson();
}

class LiveGiftTarget extends GiftTarget {
  const LiveGiftTarget({required this.liveSessionId, this.targetParticipantId});

  final String liveSessionId;
  final String? targetParticipantId;

  @override
  Map<String, dynamic> toJson() => {
        'liveSessionId': liveSessionId,
        if (targetParticipantId != null) 'targetParticipantId': targetParticipantId,
      };
}

class VideoGiftTarget extends GiftTarget {
  const VideoGiftTarget({required this.videoId});

  final String videoId;

  @override
  Map<String, dynamic> toJson() => {'videoId': videoId};
}

class PhotoPostGiftTarget extends GiftTarget {
  const PhotoPostGiftTarget({required this.photoPostId});

  final String photoPostId;

  @override
  Map<String, dynamic> toJson() => {'photoPostId': photoPostId};
}

class TextPostGiftTarget extends GiftTarget {
  const TextPostGiftTarget({required this.textPostId});

  final String textPostId;

  @override
  Map<String, dynamic> toJson() => {'textPostId': textPostId};
}

enum LiveGiftParticipantRole { host, coHost, guest, unknown }

LiveGiftParticipantRole _participantRoleFromApi(String? value) {
  switch (value) {
    case 'HOST':
      return LiveGiftParticipantRole.host;
    case 'CO_HOST':
      return LiveGiftParticipantRole.coHost;
    case 'GUEST':
      return LiveGiftParticipantRole.guest;
    default:
      return LiveGiftParticipantRole.unknown;
  }
}

/// The full, authoritative result of a successful `POST /gifts/send` —
/// every field here (recipient, attribution role, total Coins spent,
/// Diamonds credited, sender's new balance) is what the server actually
/// did, never a client-side guess.
class SendGiftResult extends Equatable {
  const SendGiftResult({
    required this.giftTransactionId,
    required this.recipientId,
    required this.participantRole,
    required this.totalCoins,
    required this.diamondsCredited,
    required this.senderBalance,
  });

  factory SendGiftResult.fromJson(Map<String, dynamic> json) {
    return SendGiftResult(
      giftTransactionId: json['giftTransactionId'] as String,
      recipientId: json['recipientId'] as String,
      participantRole: _participantRoleFromApi(json['participantRole'] as String?),
      totalCoins: json['totalCoins'] as int,
      diamondsCredited: json['diamondsCredited'] as int,
      senderBalance: json['senderBalance'] as int,
    );
  }

  final String giftTransactionId;
  final String recipientId;
  final LiveGiftParticipantRole participantRole;
  final int totalCoins;
  final int diamondsCredited;
  final int senderBalance;

  @override
  List<Object?> get props => [giftTransactionId, recipientId, participantRole, totalCoins, diamondsCredited, senderBalance];
}

/// A realtime `gift:sent` broadcast (see backend `lib/realtime.ts`
/// `emitToLiveSession`) — never carries private wallet/payment data, only
/// what's safe to show every viewer in the room.
class LiveGiftEvent extends Equatable {
  const LiveGiftEvent({
    required this.giftTransactionId,
    required this.senderId,
    this.senderUsername,
    this.senderDisplayName,
    required this.giftName,
    required this.giftSlug,
    required this.quantity,
    required this.totalCoins,
    required this.recipientId,
    required this.participantRole,
  });

  factory LiveGiftEvent.fromJson(Map<String, dynamic> json) {
    return LiveGiftEvent(
      giftTransactionId: json['giftTransactionId'] as String,
      senderId: json['senderId'] as String,
      senderUsername: json['senderUsername'] as String?,
      senderDisplayName: json['senderDisplayName'] as String?,
      giftName: json['giftName'] as String? ?? 'Gift',
      giftSlug: json['giftSlug'] as String? ?? '',
      quantity: json['quantity'] as int,
      totalCoins: json['totalCoins'] as int,
      recipientId: json['recipientId'] as String,
      participantRole: _participantRoleFromApi(json['participantRole'] as String?),
    );
  }

  final String giftTransactionId;
  final String senderId;
  final String? senderUsername;
  final String? senderDisplayName;
  final String giftName;
  final String giftSlug;
  final int quantity;
  final int totalCoins;
  final String recipientId;
  final LiveGiftParticipantRole participantRole;

  String get senderLabel => senderDisplayName ?? (senderUsername != null ? '@$senderUsername' : 'Someone');

  @override
  List<Object?> get props => [giftTransactionId];
}

/// A row of a creator's sent/received Gift history.
class GiftTransactionModel extends Equatable {
  const GiftTransactionModel({
    required this.id,
    required this.counterpartyId,
    required this.giftName,
    required this.giftSlug,
    required this.quantity,
    this.totalCoins,
    this.diamondsCredited,
    this.liveSessionId,
    required this.createdAt,
  });

  factory GiftTransactionModel.sentFromJson(Map<String, dynamic> json) {
    return GiftTransactionModel(
      id: json['id'] as String,
      counterpartyId: json['recipientId'] as String,
      giftName: json['giftName'] as String,
      giftSlug: json['giftSlug'] as String,
      quantity: json['quantity'] as int,
      totalCoins: json['totalCoins'] as int,
      liveSessionId: json['liveSessionId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  factory GiftTransactionModel.receivedFromJson(Map<String, dynamic> json) {
    return GiftTransactionModel(
      id: json['id'] as String,
      counterpartyId: json['senderId'] as String,
      giftName: json['giftName'] as String,
      giftSlug: json['giftSlug'] as String,
      quantity: json['quantity'] as int,
      diamondsCredited: json['diamondsCredited'] as int,
      liveSessionId: json['liveSessionId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String counterpartyId;
  final String giftName;
  final String giftSlug;
  final int quantity;
  final int? totalCoins;
  final int? diamondsCredited;
  final String? liveSessionId;
  final DateTime createdAt;

  @override
  List<Object?> get props => [id, counterpartyId, giftName, quantity, createdAt];
}
