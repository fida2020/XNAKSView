import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../live/domain/live_guest_model.dart';
import '../../live/presentation/live_providers.dart';
import '../../messaging/data/realtime_client.dart';
import '../../messaging/presentation/messaging_providers.dart';
import '../domain/gift_models.dart';
import 'coin_theme.dart';
import 'gift_picker_sheet.dart';

/// LIVE Gift integration (brief §4-§7) shared by both the host and viewer
/// screens: a Gift button + participant-aware picker, a realtime activity
/// feed fed by the existing LIVE Socket.IO room (never a second, parallel
/// Gift-accounting system), and — when the session is mid-Battle — a
/// lightweight note on the Gift's Battle-side contribution. The actual
/// Battle scoreboard UI does not exist on mobile yet (LIVE Match/Battle has
/// no mobile screen at all — see `live_host_screen.dart`'s own comment);
/// this only surfaces what the Gift response/event already carries.
///
/// Every recipient this overlay ever sends is either `null` (host) or a
/// userId taken from the *live* `/live/:id/guests` response — never
/// invented, and never trusted as final: the server independently
/// re-validates it on every send.
class LiveGiftOverlay extends ConsumerStatefulWidget {
  const LiveGiftOverlay({super.key, required this.liveSessionId, required this.hostId, this.hostLabel});

  final String liveSessionId;
  final String hostId;
  final String? hostLabel;

  @override
  ConsumerState<LiveGiftOverlay> createState() => LiveGiftOverlayState();
}

class LiveGiftOverlayState extends ConsumerState<LiveGiftOverlay> {
  final List<LiveGiftEvent> _activity = [];
  final Set<String> _seenTransactionIds = {};
  List<LiveGuestModel> _activeGuests = [];
  void Function()? _unsubscribe;
  Timer? _bannerTimer;
  LiveGiftEvent? _banner;

  // Captured once, rather than via `ref.read(realtimeClientProvider)` inside
  // `dispose()` — Riverpod's `ref` can no longer be read once the element is
  // partway through unmounting (e.g. an ancestor ProviderScope tearing down
  // at the same time), so `dispose()` uses this instead of a fresh lookup.
  late final RealtimeClient _realtimeClient;

  @override
  void initState() {
    super.initState();
    _realtimeClient = ref.read(realtimeClientProvider);
    _realtimeClient.joinLiveSession(widget.liveSessionId);
    _unsubscribe = _realtimeClient.on('gift:sent', _onGiftEvent);
    _loadGuests();
  }

  Future<void> _loadGuests() async {
    try {
      final result = await ref.read(liveRepositoryProvider).fetchGuests(widget.liveSessionId);
      if (mounted) {
        setState(() => _activeGuests = result.guests.where((g) => g.status == LiveGuestStatus.active).toList());
      }
    } on AppException {
      // Best-effort — the Gift button still works host-only if this fails.
    }
  }

  void _onGiftEvent(dynamic payload) {
    if (payload is! Map) return;
    final event = LiveGiftEvent.fromJson(Map<String, dynamic>.from(payload));
    // Realtime delivery is at-least-once (see `RealtimeClient`'s own
    // doc comment) — a duplicate/replayed event for a Gift already shown
    // (including one this same client just sent and rendered optimistically
    // in `sendGiftFor`) is silently ignored rather than double-rendered.
    if (_seenTransactionIds.contains(event.giftTransactionId)) return;
    _renderEvent(event);
    // A guest leaving/joining doesn't itself emit a Gift event, but a fresh
    // Gift is a reasonable moment to make sure the participant strip (and
    // therefore who can be targeted next) hasn't gone stale.
    _loadGuests();
  }

  void _renderEvent(LiveGiftEvent event) {
    _seenTransactionIds.add(event.giftTransactionId);
    if (!mounted) return;
    setState(() {
      _activity.insert(0, event);
      if (_activity.length > 30) _activity.removeLast();
      _banner = event;
    });
    _bannerTimer?.cancel();
    _bannerTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _banner = null);
    });
  }

  Future<void> openGiftPicker(BuildContext context) async {
    final recipients = <GiftRecipientOption>[
      GiftRecipientOption(id: null, label: widget.hostLabel ?? 'Host', isHost: true),
      for (final guest in _activeGuests) GiftRecipientOption(id: guest.userId, label: guest.displayLabel, isHost: false),
    ];

    final result = await showGiftPickerSheet(
      context,
      buildTarget: (targetParticipantId) => LiveGiftTarget(
        liveSessionId: widget.liveSessionId,
        targetParticipantId: targetParticipantId,
      ),
      // A single-host, no-guest LIVE has nothing to choose between — the
      // participant strip only adds value once there's an actual choice.
      recipients: recipients.length > 1 ? recipients : const [],
    );

    if (result != null) {
      // Render our own send immediately rather than waiting for the
      // realtime echo — the dedup set above then makes that echo a no-op.
      _seenTransactionIds.add(result.giftTransactionId);
    }
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _unsubscribe?.call();
    _realtimeClient.leaveLiveSession(widget.liveSessionId);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        children: [
          if (_banner != null) Positioned(top: 60, left: 12, right: 12, child: _GiftBanner(event: _banner!)),
          if (_activity.isNotEmpty) Positioned(right: 8, bottom: 220, child: _GiftActivityFeed(events: _activity.take(4).toList())),
        ],
      ),
    );
  }
}

class _GiftBanner extends StatelessWidget {
  const _GiftBanner({required this.event});

  final LiveGiftEvent event;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 250),
      child: Container(
        key: ValueKey(event.giftTransactionId),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [CoinTheme.magenta, CoinTheme.violet]),
          borderRadius: BorderRadius.circular(24),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4))],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.card_giftcard, color: Colors.white, size: 20),
            const SizedBox(width: 8),
            Flexible(
              child: Text.rich(
                TextSpan(
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  children: [
                    TextSpan(text: event.senderLabel, style: const TextStyle(fontWeight: FontWeight.bold)),
                    const TextSpan(text: ' sent '),
                    TextSpan(text: '${event.giftName}${event.quantity > 1 ? ' x${event.quantity}' : ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    if (event.participantRole == LiveGiftParticipantRole.guest || event.participantRole == LiveGiftParticipantRole.coHost)
                      const TextSpan(text: ' to a guest'),
                  ],
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GiftActivityFeed extends StatelessWidget {
  const _GiftActivityFeed({required this.events});

  final List<LiveGiftEvent> events;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final event in events)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(12)),
              child: Text(
                '${event.senderLabel} → ${event.giftName}',
                style: const TextStyle(color: Colors.white, fontSize: 11),
              ),
            ),
          ),
      ],
    );
  }
}

/// The floating Gift button (brief §3/§4) — placed by the LIVE screens
/// alongside their other controls. Opens the picker through
/// [LiveGiftOverlayState.openGiftPicker] via the [GlobalKey] the screen
/// already holds on its [LiveGiftOverlay].
class LiveGiftButton extends StatelessWidget {
  const LiveGiftButton({super.key, required this.overlayKey});

  final GlobalKey<LiveGiftOverlayState> overlayKey;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => overlayKey.currentState?.openGiftPicker(context),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: const BoxDecoration(gradient: CoinTheme.coinGradient, shape: BoxShape.circle),
        child: const Icon(Icons.card_giftcard, color: Colors.black87, size: 22),
      ),
    );
  }
}
