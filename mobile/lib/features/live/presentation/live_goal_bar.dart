import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../messaging/data/realtime_client.dart';
import '../../messaging/presentation/messaging_providers.dart';

/// LIVE Goal (Step 3/rebuild) — a real progress bar driven by the actual
/// `live:goalProgress` realtime event (see backend's giftService.ts, which
/// only ever emits it after really incrementing `goalProgressCoins` from a
/// real Gift's real totalCoins). Never a client-side timer or fabricated
/// increment — if no Gift arrives, this bar never moves.
class LiveGoalBar extends ConsumerStatefulWidget {
  const LiveGoalBar({
    super.key,
    required this.liveSessionId,
    required this.goalTitle,
    required this.targetCoins,
    required this.initialProgressCoins,
  });

  final String liveSessionId;
  final String? goalTitle;
  final int targetCoins;
  final int initialProgressCoins;

  @override
  ConsumerState<LiveGoalBar> createState() => _LiveGoalBarState();
}

class _LiveGoalBarState extends ConsumerState<LiveGoalBar> {
  late int _progressCoins = widget.initialProgressCoins;
  void Function()? _unsubscribe;
  late final RealtimeClient _realtimeClient;

  @override
  void initState() {
    super.initState();
    _realtimeClient = ref.read(realtimeClientProvider);
    _unsubscribe = _realtimeClient.on('live:goalProgress', _onGoalProgress);
  }

  void _onGoalProgress(dynamic payload) {
    if (payload is! Map) return;
    final progress = payload['goalProgressCoins'];
    if (progress is int && mounted) setState(() => _progressCoins = progress);
  }

  @override
  void dispose() {
    _unsubscribe?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fraction = widget.targetCoins > 0 ? (_progressCoins / widget.targetCoins).clamp(0.0, 1.0) : 0.0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            widget.goalTitle?.isNotEmpty == true ? widget.goalTitle! : 'LIVE Goal',
            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: fraction, minHeight: 6, backgroundColor: Colors.white24),
          ),
          const SizedBox(height: 2),
          Text('$_progressCoins / ${widget.targetCoins} Coins', style: const TextStyle(color: Colors.white70, fontSize: 10)),
        ],
      ),
    );
  }
}
