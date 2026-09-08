import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/safety/presentation/account_status_screen.dart';

import '../../support/fake_api_client.dart';

void main() {
  testWidgets('shows good standing with no enforcement history', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/account/status', respond: (_, _) => {'accountStanding': 'ACTIVE', 'enforcementHistory': []});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: AccountStatusScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Your account is in good standing.'), findsOneWidget);
    expect(find.text('No violations or restrictions on your account.'), findsOneWidget);
  });

  testWidgets('a banned account shows the enforcement action and an appeal option, never internal risk fields', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on(
      'GET',
      '/account/status',
      respond: (_, _) => {
        'accountStanding': 'BANNED',
        'enforcementHistory': [
          {
            'id': 'action-1',
            'actionType': 'PERMANENT_BAN',
            'category': 'THREATS',
            'reason': 'Severe threatening language in a comment',
            'contentType': 'VIDEO_COMMENT',
            'status': 'ACTIVE',
            'createdAt': '2026-01-01T00:00:00.000Z',
            'expiresAt': null,
            'reversedAt': null,
            'reversalReason': null,
            'appeal': null,
          },
        ],
      },
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: AccountStatusScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Your account has been permanently banned.'), findsOneWidget);
    expect(find.text('Account permanently banned'), findsOneWidget);
    expect(find.text('Appeal this decision'), findsOneWidget);
  });

  testWidgets('an already-appealed action shows appeal status instead of the appeal button', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on(
      'GET',
      '/account/status',
      respond: (_, _) => {
        'accountStanding': 'BANNED',
        'enforcementHistory': [
          {
            'id': 'action-1',
            'actionType': 'PERMANENT_BAN',
            'reason': 'test',
            'status': 'ACTIVE',
            'createdAt': '2026-01-01T00:00:00.000Z',
            'appeal': {'id': 'appeal-1', 'status': 'UNDER_REVIEW', 'decidedAt': null, 'decisionNotes': null},
          },
        ],
      },
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: const MaterialApp(home: AccountStatusScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('Appeal: Under review'), findsOneWidget);
    expect(find.text('Appeal this decision'), findsNothing);
  });
}
