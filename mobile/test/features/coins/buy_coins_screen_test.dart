import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/coins/presentation/buy_coins_screen.dart';

import '../../support/fake_api_client.dart';

void _stubPackages(FakeApiClient apiClient) {
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
}

void main() {
  testWidgets('lists Coin packages with the backend-computed Coin amount and price', (tester) async {
    final apiClient = FakeApiClient();
    _stubPackages(apiClient);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: BuyCoinsScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('186 Coins'), findsOneWidget);
    expect(find.text('\$1.00'), findsWidgets);
  });

  testWidgets('choosing App Store shows an honest "not available" error rather than faking a successful payment', (tester) async {
    final apiClient = FakeApiClient();
    _stubPackages(apiClient);
    apiClient.on('POST', '/coins/purchases', respond: (_, _) => {'purchaseId': 'purchase-1', 'status': 'CREATED'});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: BuyCoinsScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.tap(find.text('Buy for \$1.00'));
    // Let the payment-method bottom sheet finish its entrance animation
    // before tapping inside it — a bare pump() catches it mid-slide, off
    // the visible viewport, and the tap misses entirely.
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apple App Store'));
    // The sheet's own dismiss animation plus the SnackBar's entrance
    // animation both need to run before the error text is on screen — but
    // NOT pumpAndSettle(), which would also fast-forward through the
    // SnackBar's ~4s auto-dismiss timer and find nothing left to assert on.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // "aren't available" (App Store/Google Play) vs "isn't available" (Web)
    // differ in wording — match the substring common to all three.
    expect(find.textContaining('available in this build yet'), findsOneWidget);
    // Never claims Coins were credited when no real payment was verified.
    expect(find.text('Purchase complete'), findsNothing);
  });

  testWidgets('shows an empty state when no packages are configured', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/packages', respond: (_, _) => {'packages': []});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: BuyCoinsScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('No Coin packages are available right now.'), findsOneWidget);
  });
}
