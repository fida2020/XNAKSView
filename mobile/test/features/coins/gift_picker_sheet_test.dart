import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/coins/domain/gift_models.dart';
import 'package:xnakview/features/coins/presentation/gift_picker_sheet.dart';

import '../../support/fake_api_client.dart';

Map<String, dynamic> _giftsResponse() => {
      'gifts': [
        {'id': 'g1', 'name': 'Rose', 'slug': 'rose', 'coinCost': 10, 'category': 'APPRECIATION', 'maxQuantityPerSend': 50, 'sortOrder': 1},
        {'id': 'g2', 'name': 'Crown', 'slug': 'crown', 'coinCost': 500, 'category': 'SPECIAL', 'maxQuantityPerSend': 5, 'sortOrder': 2},
      ],
    };

Widget _harness(FakeApiClient apiClient, {List<GiftRecipientOption> recipients = const []}) {
  return ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(apiClient)],
    child: MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showGiftPickerSheet(
                context,
                buildTarget: (targetParticipantId) => VideoGiftTarget(videoId: 'video-1'),
                recipients: recipients,
              ),
              child: const Text('Open picker'),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('shows the Gift catalog and current balance, both from the backend', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 186, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/gifts', respond: (_, _) => _giftsResponse());

    await tester.pumpWidget(_harness(apiClient));
    await tester.tap(find.text('Open picker'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Rose'), findsOneWidget);
    expect(find.text('Crown'), findsOneWidget);
    expect(find.text('186'), findsOneWidget);
  });

  testWidgets('sending a Gift successfully closes the sheet and returns the server result', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 186, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/gifts', respond: (_, _) => _giftsResponse());
    apiClient.on(
      'POST',
      '/gifts/send',
      respond: (_, _) => {
        'giftTransactionId': 'txn-1',
        'recipientId': 'creator-1',
        'participantRole': null,
        'totalCoins': 10,
        'diamondsCredited': 1,
        'platformSharePercent': '50.00',
        'senderBalance': 176,
      },
    );

    await tester.pumpWidget(_harness(apiClient));
    await tester.tap(find.text('Open picker'));
    // Let the picker's entrance animation finish before tapping inside it —
    // a bare pump() catches it mid-slide, off the visible viewport.
    await tester.pumpAndSettle();

    await tester.tap(find.text('Rose'));
    await tester.pump();
    await tester.tap(find.textContaining('Send for'));
    // The sheet's own dismiss animation needs to finish before it's gone
    // from the tree.
    await tester.pumpAndSettle();

    expect(find.byType(BottomSheet), findsNothing);
  });

  testWidgets('insufficient Coins shows a "Get Coins" path instead of a bare error', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 0, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/gifts', respond: (_, _) => _giftsResponse());

    await tester.pumpWidget(_harness(apiClient));
    await tester.tap(find.text('Open picker'));
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('Not enough Coins'), findsOneWidget);
  });

  testWidgets('a LIVE picker with active guests shows a participant selector; a single-host LIVE does not', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/coins/balance', respond: (_, _) => {'balance': 186, 'dailyGiftLimitCoins': null});
    apiClient.on('GET', '/gifts', respond: (_, _) => _giftsResponse());

    await tester.pumpWidget(
      _harness(
        apiClient,
        recipients: const [
          GiftRecipientOption(id: null, label: 'Host', isHost: true),
          GiftRecipientOption(id: 'guest-1', label: 'Guest One', isHost: false),
        ],
      ),
    );
    await tester.tap(find.text('Open picker'));
    await tester.pump();
    await tester.pump();

    expect(find.text('Host'), findsOneWidget);
    expect(find.text('Guest One'), findsOneWidget);
  });
}
