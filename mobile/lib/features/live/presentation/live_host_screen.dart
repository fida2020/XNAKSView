import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/errors/app_exception.dart';
import '../../coins/presentation/live_gift_overlay.dart';
import '../domain/live_session_model.dart';
import 'live_battle_bar.dart';
import 'live_chat_panel.dart';
import 'live_goal_bar.dart';
import 'live_guest_sheet.dart';
import 'live_reactions_overlay.dart';
import 'live_share_sheet.dart';
import 'live_providers.dart';

/// The host's own LIVE room: publishes camera + mic to the self-hosted
/// LiveKit server (see infrastructure/docker-compose.yml) and shows a local
/// preview, viewer count, chat, and the end-LIVE control.
class LiveHostScreen extends ConsumerStatefulWidget {
  const LiveHostScreen({super.key, required this.liveSession, required this.connection, this.voiceOnly = false});

  final LiveSessionModel liveSession;
  final LiveConnectionInfo connection;

  /// Voice Chat LIVE mode — publishes mic only, camera stays off for the
  /// whole session. LiveKit natively supports an audio-only local
  /// participant (no custom pipeline needed); the only difference from a
  /// normal broadcast is that `setCameraEnabled` is never called.
  final bool voiceOnly;

  @override
  ConsumerState<LiveHostScreen> createState() => _LiveHostScreenState();
}

class _LiveHostScreenState extends ConsumerState<LiveHostScreen> {
  late final Room _room;
  EventsListener<RoomEvent>? _listener;
  Timer? _viewerCountTimer;
  final _battleBarKey = GlobalKey<LiveBattleBarState>();
  final _reactionsKey = GlobalKey<LiveReactionsOverlayState>();

  bool _isConnecting = true;
  bool _isEnding = false;
  String? _error;
  int _viewerCount = 0;

  @override
  void initState() {
    super.initState();
    _viewerCount = widget.liveSession.viewerCount;
    _room = Room();
    _listener = _room.createListener();
    _listener!.on<RoomDisconnectedEvent>((_) {
      if (mounted && !_isEnding) {
        setState(() => _error = 'Disconnected from the LIVE server.');
      }
    });
    // Viewer count comes from the backend's `LiveViewer`-tracked join/leave
    // count — the same source of truth admin/discovery/the viewer screen
    // use — not from the LiveKit room's participant list. Room participants
    // include co-hosts/guests once that feature has mobile UI, which would
    // double-count them as "viewers"; polling the API avoids that by
    // construction (guests are never LiveViewer rows).
    _viewerCountTimer = Timer.periodic(const Duration(seconds: 5), (_) => _refreshViewerCount());
    _connect();
  }

  Future<void> _refreshViewerCount() async {
    try {
      final liveSession = await ref.read(liveRepositoryProvider).fetchLiveSession(widget.liveSession.id);
      if (mounted) setState(() => _viewerCount = liveSession.viewerCount);
    } on AppException {
      // Best-effort background refresh — a transient failure shouldn't
      // interrupt the broadcast.
    }
  }

  Future<void> _connect() async {
    final mic = await Permission.microphone.request();
    final camera = widget.voiceOnly ? PermissionStatus.granted : await Permission.camera.request();
    if (!camera.isGranted || !mic.isGranted) {
      if (mounted) {
        setState(() {
          _isConnecting = false;
          _error = widget.voiceOnly ? 'Microphone permission is required to go LIVE.' : 'Camera and microphone permissions are required to go LIVE.';
        });
      }
      return;
    }

    try {
      await _room.connect(widget.connection.wsUrl, widget.connection.token);
      if (!widget.voiceOnly) await _room.localParticipant?.setCameraEnabled(true);
      await _room.localParticipant?.setMicrophoneEnabled(true);
      if (mounted) setState(() => _isConnecting = false);
    } catch (error) {
      if (mounted) {
        setState(() {
          _isConnecting = false;
          _error = 'Failed to start the broadcast: $error';
        });
      }
    }
  }

  Future<void> _endLive() async {
    if (_isEnding) return;
    setState(() => _isEnding = true);
    try {
      await ref.read(liveRepositoryProvider).endLive(widget.liveSession.id);
    } on AppException {
      // Even if the API call fails we still tear down the local broadcast —
      // an inconsistent server-side status shouldn't trap the host on-screen.
    } finally {
      await _room.disconnect();
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  void dispose() {
    _viewerCountTimer?.cancel();
    _listener?.dispose();
    _room.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmEnd();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Stack(
            children: [
              Positioned.fill(child: _buildPreview()),
              Positioned(
                top: 12,
                left: 12,
                right: 12,
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(color: Colors.red, borderRadius: BorderRadius.circular(4)),
                      child: const Text('LIVE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(width: 8),
                    Row(
                      children: [
                        const Icon(Icons.remove_red_eye, color: Colors.white, size: 16),
                        const SizedBox(width: 4),
                        Text('$_viewerCount', style: const TextStyle(color: Colors.white)),
                      ],
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.ios_share, color: Colors.white),
                      tooltip: 'Share',
                      onPressed: () => showLiveShareSheet(context, liveSessionId: widget.liveSession.id, title: widget.liveSession.title),
                    ),
                    IconButton(
                      icon: const Icon(Icons.group_outlined, color: Colors.white),
                      tooltip: 'Guests',
                      onPressed: () => showGuestManagementSheet(context, widget.liveSession.id, widget.liveSession.hostId),
                    ),
                    PopupMenuButton<bool>(
                      icon: const Icon(Icons.sports_kabaddi, color: Colors.white),
                      tooltip: 'Battle',
                      onSelected: (asTeamMatch) => _battleBarKey.currentState?.openChallengePicker(context, asTeamMatch: asTeamMatch),
                      itemBuilder: (context) => const [
                        PopupMenuItem(value: false, child: Text('1v1 Battle')),
                        PopupMenuItem(value: true, child: Text('Team Battle')),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: _confirmEnd,
                    ),
                  ],
                ),
              ),
              Positioned(
                top: 52,
                left: 0,
                right: 0,
                child: LiveBattleBar(key: _battleBarKey, liveSessionId: widget.liveSession.id, isHost: true, hostSessionId: widget.liveSession.id),
              ),
              if (widget.liveSession.goalEnabled && widget.liveSession.goalTargetCoins != null)
                Positioned(
                  top: 96,
                  left: 12,
                  right: 12,
                  child: LiveGoalBar(
                    liveSessionId: widget.liveSession.id,
                    goalTitle: widget.liveSession.goalTitle,
                    targetCoins: widget.liveSession.goalTargetCoins!,
                    initialProgressCoins: widget.liveSession.goalProgressCoins,
                  ),
                ),
              // Display only — the host's own screen never sends a Gift
              // (there's no viewer-side "target the host" concept for the
              // host to use), but the host still sees the same realtime
              // activity feed/animation viewers do when a Gift lands on
              // this session or one of its guests.
              Positioned.fill(
                child: LiveGiftOverlay(
                  liveSessionId: widget.liveSession.id,
                  hostId: widget.liveSession.hostId,
                  hostLabel: widget.liveSession.host?.displayLabel,
                ),
              ),
              Positioned.fill(child: LiveReactionsOverlay(key: _reactionsKey, liveSessionId: widget.liveSession.id)),
              Positioned(
                right: 12,
                bottom: 200,
                child: LiveReactionButton(overlayKey: _reactionsKey),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: LiveChatPanel(liveSessionId: widget.liveSession.id),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _confirmEnd() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('End LIVE?'),
        content: const Text('Your viewers will be disconnected and the stream will be marked as ended.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              _endLive();
            },
            child: const Text('End LIVE'),
          ),
        ],
      ),
    );
  }

  Widget _buildPreview() {
    if (_isConnecting || _isEnding) {
      return const Center(child: CircularProgressIndicator(color: Colors.white));
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(_error!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
        ),
      );
    }

    if (widget.voiceOnly) {
      return Container(
        color: Colors.grey.shade900,
        child: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.mic, color: Colors.white, size: 64),
              SizedBox(height: 12),
              Text('Voice Chat LIVE — camera off', style: TextStyle(color: Colors.white70)),
            ],
          ),
        ),
      );
    }

    LocalVideoTrack? localVideoTrack;
    for (final pub in _room.localParticipant?.videoTrackPublications ?? const []) {
      if (pub.track is LocalVideoTrack) {
        localVideoTrack = pub.track as LocalVideoTrack;
        break;
      }
    }

    if (localVideoTrack == null) {
      return const Center(
        child: Text('Starting camera…', style: TextStyle(color: Colors.white70)),
      );
    }

    return VideoTrackRenderer(localVideoTrack, mirrorMode: VideoViewMirrorMode.mirror);
  }
}
