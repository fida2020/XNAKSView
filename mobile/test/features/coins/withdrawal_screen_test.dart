import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/coins/presentation/withdrawal_screen.dart';

import '../../support/fake_api_client.dart';

void main() {
  testWidgets('shows the real onboarding state (bank account / verification not yet done) rather than pretending they are', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/creator/earnings', respond: (_, _) => {'balanceMinorUnits': 0, 'currency': 'USD'});
    apiClient.on('GET', '/creator/withdrawals', respond: (_, _) => {'withdrawals': [], 'nextCursor': null});
    apiClient.on('GET', '/creator/payout-method', respond: (_, _) => {'payoutMethod': null});
    apiClient.on('GET', '/creator/identity-verification', respond: (_, _) => {'verification': null});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: WithdrawalScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Not added'), findsOneWidget); // bank account
    expect(find.text('Not started'), findsOneWidget); // identity verification
  });

  testWidgets('every withdrawal status the backend can send renders with a readable label', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/creator/earnings', respond: (_, _) => {'balanceMinorUnits': 0, 'currency': 'USD'});
    apiClient.on('GET', '/creator/payout-method', respond: (_, _) => {'payoutMethod': null});
    apiClient.on('GET', '/creator/identity-verification', respond: (_, _) => {'verification': null});
    apiClient.on(
      'GET',
      '/creator/withdrawals',
      respond: (_, _) => {
        'withdrawals': [
          {'id': 'w1', 'amountMinorUnits': 5000, 'currency': 'USD', 'status': 'REQUESTED', 'createdAt': '2026-01-01T00:00:00.000Z'},
          {'id': 'w2', 'amountMinorUnits': 6000, 'currency': 'USD', 'status': 'PAID', 'createdAt': '2026-01-02T00:00:00.000Z'},
          {'id': 'w3', 'amountMinorUnits': 7000, 'currency': 'USD', 'status': 'REJECTED', 'rejectionReason': 'Suspicious destination', 'createdAt': '2026-01-03T00:00:00.000Z'},
        ],
        'nextCursor': null,
      },
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: WithdrawalScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Cancel'), findsOneWidget); // only the REQUESTED one is cancellable
    expect(find.text('Paid'), findsOneWidget);
    expect(find.text('Rejected'), findsOneWidget);
    expect(find.textContaining('Suspicious destination'), findsOneWidget);
  });

  testWidgets('a creator with a verified bank account and identity goes straight to Amount, and a server rejection is shown, never a fake success', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/creator/earnings', respond: (_, _) => {'balanceMinorUnits': 100000, 'currency': 'USD'});
    apiClient.on('GET', '/creator/withdrawals', respond: (_, _) => {'withdrawals': [], 'nextCursor': null});
    apiClient.on(
      'GET',
      '/creator/payout-method',
      respond: (_, _) => {
        'payoutMethod': {
          'id': 'pm1',
          'country': 'US',
          'currency': 'USD',
          'bankDetailsMasked': {'accountHolderName': 'Test Creator'},
          'status': 'VERIFIED',
        },
      },
    );
    apiClient.on(
      'GET',
      '/creator/identity-verification',
      respond: (_, _) => {
        'verification': {'id': 'v1', 'status': 'APPROVED'},
      },
    );
    apiClient.on(
      'GET',
      '/creator/withdrawals/preview',
      respond: (_, _) => {
        'amountMinorUnits': 100,
        'currency': 'USD',
        'feeMinorUnits': 10,
        'netAmountMinorUnits': 90,
        'estimatedProcessingDays': 3,
        'countryCode': 'US',
      },
    );
    apiClient.on(
      'POST',
      '/creator/withdrawals',
      throwing: (_, _) => const ForbiddenException('The minimum withdrawal amount is 5000 minor units'),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: WithdrawalScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.tap(find.text('Withdraw'));
    await tester.pumpAndSettle();

    // Already verified — routed straight to the Amount screen, no Bank Account/Verification step shown.
    expect(find.text('Available: 1000.00 USD'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Amount (USD)'), '1.00');
    await tester.pump(const Duration(milliseconds: 500)); // debounce before the preview fetch fires
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Withdraw'));
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('minimum withdrawal amount'), findsOneWidget);
  });
}
