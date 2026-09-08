import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../messaging/data/realtime_client.dart';
import '../../messaging/presentation/messaging_providers.dart';
import 'live_providers.dart';

const _kReactionEmojis = ['❤️', '👍', '😂', '🔥', '👏'];

/// Real-time LIVE reactions — a real `POST /live/:id/reactions` call per
/// tap, rendered via the real `live:reaction` Socket.IO event (same LIVE
/// room every other realtime feature here uses). Every floating icon on
/// screen corresponds to one real reaction someone actually sent — there
/// is no simulated/local-only reaction and no fabricated counter.
class LiveReactionsOverlay extends ConsumerStatefulWidget {
  const LiveReactionsOverlay({super.key, required this.liveSessionId});

  final String liveSessionId;

  @override
  ConsumerState<LiveReactionsOverlay> createState() => LiveReactionsOverlayState();
}

class LiveReactionsOverlayState extends ConsumerState<LiveReactionsOverlay> {
  final List<_FloatingReaction> _floating = [];
  void Function()? _unsubscribe;
  late final RealtimeClient _realtimeClient;
  int _nextId = 0;

  @override
  void initState() {
    super.initState();
    _realtimeClient = ref.read(realtimeClientProvider);
    _unsubscribe = _realtimeClient.on('live:reaction', _onReaction);
  }

  void _onReaction(dynamic payload) {
    if (payload is! Map) return;
    final emoji = payload['emoji'] as String?;
    if (emoji == null) return;
    _addFloating(emoji);
  }

  void _addFloating(String emoji) {
    final id = _nextId++;
    final random = Random();
    setState(() => _floating.add(_FloatingReaction(id: id, emoji: emoji, startX: 0.2 + random.nextDouble() * 0.6)));
    Timer(const Duration(milliseconds: 2200), () {
      if (mounted) setState(() => _floating.removeWhere((r) => r.id == id));
    });
  }

  /// Sends a real reaction and renders it locally immediately (no need to
  /// wait for the realtime echo of your own tap).
  Future<void> sendReaction(String emoji) async {
    _addFloating(emoji);
    await ref.read(liveRepositoryProvider).sendReaction(widget.liveSessionId, emoji);
  }

  @override
  void dispose() {
    _unsubscribe?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        children: [for (final reaction in _floating) _FloatingReactionWidget(key: ValueKey(reaction.id), reaction: reaction)],
      ),
    );
  }
}

class _FloatingReaction {
  _FloatingReaction({required this.id, required this.emoji, required this.startX});
  final int id;
  final String emoji;
  final double startX;
}

class _FloatingReactionWidget extends StatefulWidget {
  const _FloatingReactionWidget({super.key, required this.reaction});
  final _FloatingReaction reaction;

  @override
  State<_FloatingReactionWidget> createState() => _FloatingReactionWidgetState();
}

class _FloatingReactionWidgetState extends State<_FloatingReactionWidget> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))..forward();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final size = MediaQuery.of(context).size;
        final progress = _controller.value;
        return Positioned(
          left: widget.reaction.startX * size.width,
          bottom: 100 + progress * (size.height * 0.55),
          child: Opacity(
            opacity: (1 - progress).clamp(0.0, 1.0),
            child: Text(widget.reaction.emoji, style: const TextStyle(fontSize: 32)),
          ),
        );
      },
    );
  }
}

/// The tap-to-react row (❤️ 👍 😂 🔥 👏) placed by the host/viewer screens
/// alongside their other controls.
class LiveReactionButton extends StatelessWidget {
  const LiveReactionButton({super.key, required this.overlayKey});

  final GlobalKey<LiveReactionsOverlayState> overlayKey;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: Colors.transparent,
        builder: (context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                for (final emoji in _kReactionEmojis)
                  GestureDetector(
                    onTap: () {
                      overlayKey.currentState?.sendReaction(emoji);
                      Navigator.of(context).pop();
                    },
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                      child: Text(emoji, style: const TextStyle(fontSize: 24)),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: const BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
        child: const Text('❤️', style: TextStyle(fontSize: 18)),
      ),
    );
  }
}
