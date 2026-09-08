import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/coins/presentation/live_gift_overlay.dart';
import 'package:xnakview/features/messaging/presentation/messaging_providers.dart';

import '../../support/fake_api_client.dart';
import '../../support/fake_realtime_client.dart';

Map<String, dynamic> _hostGiftEvent() => {
      'giftTransactionId': 'txn-1',
      'senderId': 'sender-1',
      'senderUsername': 'alice',
      'senderDisplayName': null,
      'giftId': 'g1',
      'giftName': 'Rose',
      'giftSlug': 'rose',
      'animationAssetKey': null,
      'quantity': 1,
      'totalCoins': 10,
      'recipientId': 'host-1',
      'participantRole': 'HOST',
    };

Map<String, dynamic> _guestGiftEvent() => {
      'giftTransactionId': 'txn-2',
      'senderId': 'sender-1',
      'senderUsername': 'alice',
      'senderDisplayName': null,
      'giftId': 'g1',
      'giftName': 'Rose',
      'giftSlug': 'rose',
      'animationAssetKey': null,
      'quantity': 1,
      'totalCoins': 10,
      'recipientId': 'guest-1',
      'participantRole': 'GUEST',
    };

void main() {
  testWidgets('joins the LIVE session\'s realtime room on mount and leaves it on dispose', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/live/live-1/guests', respond: (_, _) => {'guests': [], 'maxGuestSlots': 1});
    final realtimeClient = FakeRealtimeClient();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient), realtimeClientProvider.overrideWithValue(realtimeClient)],
        child: const MaterialApp(
          home: Scaffold(body: LiveGiftOverlay(liveSessionId: 'live-1', hostId: 'host-1', hostLabel: 'Host One')),
        ),
      ),
    );
    await tester.pump();

    expect(realtimeClient.joinedLiveSessions, contains('live-1'));

    await tester.pumpWidget(const SizedBox());
    expect(realtimeClient.leftLiveSessions, contains('live-1'));
  });

  testWidgets('renders a banner attributing a Gift to the HOST', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/live/live-1/guests', respond: (_, _) => {'guests': [], 'maxGuestSlots': 1});
    final realtimeClient = FakeRealtimeClient();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient), realtimeClientProvider.overrideWithValue(realtimeClient)],
        child: const MaterialApp(
          home: Scaffold(body: LiveGiftOverlay(liveSessionId: 'live-1', hostId: 'host-1', hostLabel: 'Host One')),
        ),
      ),
    );
    await tester.pump();
    // The Gift banner clears itself via a 3-second Timer — leaving it
    // pending past the end of the test trips flutter_test's "pending
    // timer" check, so tear it down by unmounting (which cancels it).
    addTearDown(() => tester.pumpWidget(const SizedBox()));

    realtimeClient.emit('gift:sent', _hostGiftEvent());
    await tester.pump();

    expect(find.textContaining('alice'), findsWidgets);
    expect(find.textContaining('Rose'), findsWidgets);
  });

  testWidgets('renders a banner attributing a Gift to a GUEST, distinguishable from a host Gift', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/live/live-1/guests', respond: (_, _) => {'guests': [], 'maxGuestSlots': 2});
    final realtimeClient = FakeRealtimeClient();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient), realtimeClientProvider.overrideWithValue(realtimeClient)],
        child: const MaterialApp(
          home: Scaffold(body: LiveGiftOverlay(liveSessionId: 'live-1', hostId: 'host-1', hostLabel: 'Host One')),
        ),
      ),
    );
    await tester.pump();
    addTearDown(() => tester.pumpWidget(const SizedBox()));

    realtimeClient.emit('gift:sent', _guestGiftEvent());
    await tester.pump();

    expect(find.textContaining('to a guest'), findsOneWidget);
  });

  testWidgets('a duplicate/replayed realtime event for the same Gift is never rendered twice', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('GET', '/live/live-1/guests', respond: (_, _) => {'guests': [], 'maxGuestSlots': 1});
    final realtimeClient = FakeRealtimeClient();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient), realtimeClientProvider.overrideWithValue(realtimeClient)],
        child: const MaterialApp(
          home: Scaffold(body: LiveGiftOverlay(liveSessionId: 'live-1', hostId: 'host-1', hostLabel: 'Host One')),
        ),
      ),
    );
    await tester.pump();
    addTearDown(() => tester.pumpWidget(const SizedBox()));

    realtimeClient.emit('gift:sent', _hostGiftEvent());
    await tester.pump();
    realtimeClient.emit('gift:sent', _hostGiftEvent()); // same giftTransactionId, replayed
    await tester.pump();

    // The activity feed keeps a running list — a duplicate would add a
    // second identical row, which findsOneWidget below would catch.
    expect(find.textContaining('alice → Rose'), findsOneWidget);
  });
}
