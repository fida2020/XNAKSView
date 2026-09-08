import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/coins/presentation/creator_earnings_screen.dart';

import '../../support/fake_api_client.dart';

void main() {
  testWidgets('shows Diamonds and Earnings as two separate balances, never one merged number', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/creator/diamonds', respond: (_, _) => {'balance': 42});
    apiClient.on('GET', '/creator/earnings', respond: (_, _) => {'balanceMinorUnits': 1250, 'currency': 'USD'});
    apiClient.on('GET', '/creator/diamonds/history', respond: (_, _) => {'history': [], 'nextCursor': null});
    apiClient.on('GET', '/creator/earnings/history', respond: (_, _) => {'history': [], 'nextCursor': null});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: CreatorEarningsScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('42'), findsOneWidget);
    expect(find.text('12.50'), findsOneWidget);
    // No button anywhere converts Diamonds into earnings client-side (brief §9).
    expect(find.textContaining('Convert'), findsNothing);
  });

  testWidgets('an empty Diamond history explains where Diamonds come from', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/creator/diamonds', respond: (_, _) => {'balance': 0});
    apiClient.on('GET', '/creator/earnings', respond: (_, _) => {'balanceMinorUnits': 0, 'currency': 'USD'});
    apiClient.on('GET', '/creator/diamonds/history', respond: (_, _) => {'history': [], 'nextCursor': null});
    apiClient.on('GET', '/creator/earnings/history', respond: (_, _) => {'history': [], 'nextCursor': null});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: CreatorEarningsScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('earned from Gifts'), findsOneWidget);
  });
}
