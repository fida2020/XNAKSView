import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/features/coins/data/coins_repository.dart';

import '../../support/fake_api_client.dart';

void main() {
  late FakeApiClient apiClient;
  late CoinsRepository repository;

  setUp(() {
    apiClient = FakeApiClient();
    repository = CoinsRepository(apiClient);
  });

  group('fetchBalance', () {
    test('returns exactly what the backend sent — never recomputed client-side', () async {
      apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 186, 'dailyGiftLimitCoins': null});

      final balance = await repository.fetchBalance();

      expect(balance.balance, 186);
      expect(balance.dailyGiftLimitCoins, isNull);
    });
  });

  group('fetchPackages', () {
    test('surfaces backend-computed pricing untouched (locked 1 Coin = PKR 1.50 lives server-side only)', () async {
      apiClient.on(
        'GET',
        '/coins/packages',
        respond: (_, _) => {
          'packages': [
            {
              'id': 'pkg-1',
              'baseUsdPrice': '1.00',
              'taxUsd': '0.00',
              'feeUsd': '0.00',
              'totalUsdPrice': '1.00',
              'exchangeRatePkrPerUsd': '280.0000',
              'coinValuePkr': '1.5000',
              'coinAmount': 186,
              'active': true,
              'sortOrder': 1,
            },
          ],
        },
      );

      final packages = await repository.fetchPackages();

      expect(packages, hasLength(1));
      expect(packages.first.coinAmount, 186);
      expect(packages.first.totalUsdPrice, '1.00');
    });

    test('propagates a network failure as an AppException rather than swallowing it', () async {
      apiClient.on('GET', '/coins/packages', throwing: (_, _) => const NetworkException());

      expect(repository.fetchPackages(), throwsA(isA<NetworkException>()));
    });
  });

  group('purchase lifecycle', () {
    test('creates a purchase and returns its id', () async {
      apiClient.on(
        'POST',
        '/coins/purchases',
        respond: (_, data) {
          final body = data as Map<String, dynamic>;
          expect(body['packageId'], 'pkg-1');
          expect(body['provider'], 'WEB');
          return {'purchaseId': 'purchase-1', 'status': 'CREATED'};
        },
      );

      final purchaseId = await repository.createPurchase(packageId: 'pkg-1', provider: 'WEB', idempotencyKey: 'idem-1');

      expect(purchaseId, 'purchase-1');
    });

    test('a verified purchase reports COINS_CREDITED and the new balance', () async {
      apiClient.on(
        'POST',
        '/coins/purchases/purchase-1/verify',
        respond: (_, _) => {'status': 'COINS_CREDITED', 'coinAmount': 186, 'balance': 186},
      );

      final result = await repository.verifyPurchase(purchaseId: 'purchase-1', receipt: 'signed-receipt');

      expect(result.status, 'COINS_CREDITED');
      expect(result.balance, 186);
    });

    test('an unverifiable receipt surfaces as a normal AppException — never a silent success', () async {
      apiClient.on(
        'POST',
        '/coins/purchases/purchase-1/verify',
        throwing: (_, _) => const ServerException('Payment could not be verified', statusCode: 400),
      );

      expect(
        repository.verifyPurchase(purchaseId: 'purchase-1', receipt: 'bad-receipt'),
        throwsA(isA<ServerException>()),
      );
    });
  });

  group('setDailyGiftLimit', () {
    test('round-trips the limit the server actually stored', () async {
      apiClient.on(
        'PATCH',
        '/coins/wallet/daily-limit',
        respond: (_, data) {
          expect((data as Map<String, dynamic>)['dailyGiftLimitCoins'], 500);
          return {'dailyGiftLimitCoins': 500};
        },
      );

      final limit = await repository.setDailyGiftLimit(500);

      expect(limit, 500);
    });
  });
}
