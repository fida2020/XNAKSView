import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/coins/presentation/coin_wallet_screen.dart';

import '../../support/fake_api_client.dart';

Future<void> _pumpWallet(WidgetTester tester, FakeApiClient apiClient) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(apiClient)],
      child: const MaterialApp(home: CoinWalletScreen()),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('shows a loading indicator before the balance arrives', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 186, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/coins/history', respond: (_, _) => {'history': [], 'nextCursor': null});
    apiClient.on('GET', '/coins/purchases', respond: (_, _) => {'purchases': [], 'nextCursor': null});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: CoinWalletScreen()),
      ),
    );
    // Before the very first pump resolves the balance future.
    expect(find.byType(CircularProgressIndicator), findsWidgets);
  });

  testWidgets('renders the balance the backend returned, not a client-computed value', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 186, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/coins/history', respond: (_, _) => {'history': [], 'nextCursor': null});
    apiClient.on('GET', '/coins/purchases', respond: (_, _) => {'purchases': [], 'nextCursor': null});

    await _pumpWallet(tester, apiClient);

    expect(find.text('186'), findsOneWidget);
  });

  testWidgets('shows an empty state for Coin History when there is none', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 0, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/coins/history', respond: (_, _) => {'history': [], 'nextCursor': null});
    apiClient.on('GET', '/coins/purchases', respond: (_, _) => {'purchases': [], 'nextCursor': null});

    await _pumpWallet(tester, apiClient);

    expect(find.text('No Coin activity yet.'), findsOneWidget);
  });

  testWidgets('shows a retry affordance on error instead of a blank screen', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 0, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/coins/history', throwing: (_, _) => const ServerException('Something went wrong', statusCode: 500));
    apiClient.on('GET', '/coins/purchases', respond: (_, _) => {'purchases': [], 'nextCursor': null});

    await _pumpWallet(tester, apiClient);

    expect(find.text('Retry'), findsWidgets);
  });

  testWidgets('lists Coin History entries with backend-provided amounts and labels', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 176, 'dailyGiftLimitCoins': null});
    apiClient.on(
      'GET',
      '/coins/history',
      respond: (_, _) => {
        'history': [
          {
            'id': 'e1',
            'direction': 'DEBIT',
            'type': 'GIFT_SENT',
            'amount': 10,
            'beforeBalance': 186,
            'afterBalance': 176,
            'referenceType': 'GIFT',
            'referenceId': 'idem-1',
            'createdAt': '2026-01-01T00:00:00.000Z',
          },
        ],
        'nextCursor': null,
      },
    );
    apiClient.on('GET', '/coins/purchases', respond: (_, _) => {'purchases': [], 'nextCursor': null});

    await _pumpWallet(tester, apiClient);

    expect(find.text('Gift sent'), findsOneWidget);
    expect(find.text('-10'), findsOneWidget);
  });
}
