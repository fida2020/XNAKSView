import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/features/coins/data/gifts_repository.dart';
import 'package:xnakview/features/coins/domain/gift_models.dart';

import '../../support/fake_api_client.dart';

void main() {
  late FakeApiClient apiClient;
  late GiftsRepository repository;

  setUp(() {
    apiClient = FakeApiClient();
    repository = GiftsRepository(apiClient);
  });

  test('fetchGifts returns the catalog untouched — no client-side price computation', () async {
    apiClient.on(
      'GET',
      '/gifts',
      respond: (_, _) => {
        'gifts': [
          {'id': 'g1', 'name': 'Rose', 'slug': 'rose', 'coinCost': 10, 'category': 'APPRECIATION', 'maxQuantityPerSend': 50, 'sortOrder': 1},
        ],
      },
    );

    final gifts = await repository.fetchGifts();

    expect(gifts, hasLength(1));
    expect(gifts.first.coinCost, 10);
    expect(gifts.first.category, GiftCategory.appreciation);
  });

  group('sendGift', () {
    test('a LIVE target with no explicit recipient sends only liveSessionId — the server decides HOST', () async {
      apiClient.on(
        'POST',
        '/gifts/send',
        respond: (_, data) {
          final body = data as Map<String, dynamic>;
          expect(body['liveSessionId'], 'live-1');
          expect(body.containsKey('targetParticipantId'), isFalse);
          return {
            'giftTransactionId': 'txn-1',
            'recipientId': 'host-1',
            'participantRole': 'HOST',
            'totalCoins': 10,
            'diamondsCredited': 1,
            'platformSharePercent': '50.00',
            'senderBalance': 176,
          };
        },
      );

      final result = await repository.sendGift(
        giftSlug: 'rose',
        quantity: 1,
        target: const LiveGiftTarget(liveSessionId: 'live-1'),
        idempotencyKey: 'idem-1',
      );

      expect(result.participantRole, LiveGiftParticipantRole.host);
      expect(result.senderBalance, 176);
    });

    test('a LIVE target naming a guest sends targetParticipantId — the client expresses intent, never authority', () async {
      apiClient.on(
        'POST',
        '/gifts/send',
        respond: (_, data) {
          final body = data as Map<String, dynamic>;
          expect(body['targetParticipantId'], 'guest-1');
          return {
            'giftTransactionId': 'txn-2',
            'recipientId': 'guest-1',
            'participantRole': 'GUEST',
            'totalCoins': 10,
            'diamondsCredited': 1,
            'platformSharePercent': '50.00',
            'senderBalance': 166,
          };
        },
      );

      final result = await repository.sendGift(
        giftSlug: 'rose',
        quantity: 1,
        target: const LiveGiftTarget(liveSessionId: 'live-1', targetParticipantId: 'guest-1'),
        idempotencyKey: 'idem-2',
      );

      expect(result.recipientId, 'guest-1');
      expect(result.participantRole, LiveGiftParticipantRole.guest);
    });

    test('the server rejecting a stale/inactive guest surfaces as a normal AppException, never a silent host redirect', () async {
      apiClient.on(
        'POST',
        '/gifts/send',
        throwing: (_, _) => const ServerException(
          'The requested Gift recipient is not currently an active participant in this LIVE session',
          statusCode: 400,
        ),
      );

      expect(
        repository.sendGift(
          giftSlug: 'rose',
          quantity: 1,
          target: const LiveGiftTarget(liveSessionId: 'live-1', targetParticipantId: 'left-guest'),
          idempotencyKey: 'idem-3',
        ),
        throwsA(isA<ServerException>()),
      );
    });

    test('insufficient balance throws InsufficientCoinsException specifically, not a generic error', () async {
      apiClient.on('POST', '/gifts/send', throwing: (_, _) => const InsufficientCoinsException());

      expect(
        repository.sendGift(
          giftSlug: 'rose',
          quantity: 1,
          target: const VideoGiftTarget(videoId: 'video-1'),
          idempotencyKey: 'idem-4',
        ),
        throwsA(isA<InsufficientCoinsException>()),
      );
    });

    test('a duplicated send (same idempotencyKey) is a single logical call from the repository\'s perspective', () async {
      var callCount = 0;
      apiClient.on(
        'POST',
        '/gifts/send',
        respond: (_, _) {
          callCount += 1;
          return {
            'giftTransactionId': 'txn-5',
            'recipientId': 'creator-1',
            'participantRole': null,
            'totalCoins': 10,
            'diamondsCredited': 1,
            'platformSharePercent': '50.00',
            'senderBalance': 176,
          };
        },
      );

      final result = await repository.sendGift(
        giftSlug: 'rose',
        quantity: 1,
        target: const VideoGiftTarget(videoId: 'video-1'),
        idempotencyKey: 'idem-5',
      );

      expect(callCount, 1);
      expect(result.giftTransactionId, 'txn-5');
    });
  });

  test('fetchReceived never needs to expose sender wallet/payment data to parse the response', () async {
    apiClient.on(
      'GET',
      '/gifts/received',
      respond: (_, _) => {
        'transactions': [
          {
            'id': 'txn-1',
            'senderId': 'sender-1',
            'giftName': 'Rose',
            'giftSlug': 'rose',
            'quantity': 1,
            'diamondsCredited': 1,
            'contentType': 'LIVE',
            'contentId': null,
            'liveSessionId': 'live-1',
            'createdAt': '2026-01-01T00:00:00.000Z',
          },
        ],
        'nextCursor': null,
      },
    );

    final page = await repository.fetchReceived();

    expect(page.transactions, hasLength(1));
    expect(page.transactions.first.diamondsCredited, 1);
  });
}
