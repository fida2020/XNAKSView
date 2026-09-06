import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/live_session_model.dart';
import 'live_chat_panel.dart';
import 'live_providers.dart';

/// A viewer's view of someone else's LIVE room: subscribes to the host's
/// video/audio tracks published to the self-hosted LiveKit server, shows
/// chat, viewer count, and a report control. Joins on mount, leaves on
/// dispose so the server-side viewer count/session cleanup stays accurate.
class LiveViewerScreen extends ConsumerStatefulWidget {
  const LiveViewerScreen({super.key, required this.liveSessionId});

  final String liveSessionId;

  @override
  ConsumerState<LiveViewerScreen> createState() => _LiveViewerScreenState();
}

class _LiveViewerScreenState extends ConsumerState<LiveViewerScreen> {
  final Room _room = Room();
  EventsListener<RoomEvent>? _listener;
  Timer? _viewerCountTimer;

  LiveSessionModel? _liveSession;
  VideoTrack? _hostVideoTrack;
  int _viewerCount = 0;
  bool _isLoading = true;
  bool _hasJoined = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _listener = _room.createListener();
    _listener!
      ..on<TrackSubscribedEvent>((event) {
        if (event.track is VideoTrack && mounted) {
          setState(() => _hostVideoTrack = event.track as VideoTrack);
        }
      })
      ..on<TrackUnsubscribedEvent>((event) {
        if (mounted && event.track == _hostVideoTrack) {
          setState(() => _hostVideoTrack = null);
        }
      })
      ..on<RoomDisconnectedEvent>((_) {
        if (mounted) setState(() => _error = 'The LIVE stream has ended or the connection was lost.');
      });
    _join();
    // The initial count comes from the join response; after that, poll the
    // same DB-backed `viewerCount` the host screen and admin/discovery use,
    // so the badge doesn't go stale for the rest of the stream and doesn't
    // ever mix in co-host/guest participants (see live_host_screen.dart).
    _viewerCountTimer = Timer.periodic(const Duration(seconds: 5), (_) => _refreshViewerCount());
  }

  Future<void> _refreshViewerCount() async {
    if (!_hasJoined) return;
    try {
      final liveSession = await ref.read(liveRepositoryProvider).fetchLiveSession(widget.liveSessionId);
      if (mounted) setState(() => _viewerCount = liveSession.viewerCount);
    } on AppException {
      // Best-effort background refresh.
    }
  }

  Future<void> _join() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final liveSession = await ref.read(liveRepositoryProvider).fetchLiveSession(widget.liveSessionId);
      if (liveSession.status != LiveStatus.live) {
        if (mounted) {
          setState(() {
            _liveSession = liveSession;
            _isLoading = false;
            _error = 'This LIVE stream has ended.';
          });
        }
        return;
      }

      final result = await ref.read(liveRepositoryProvider).join(widget.liveSessionId);
      _hasJoined = true;
      await _room.connect(result.connection.wsUrl, result.connection.token);
      _attachExistingVideoTrack();

      if (mounted) {
        setState(() {
          _liveSession = liveSession;
          _viewerCount = result.viewerCount;
          _isLoading = false;
        });
      }
    } on AppException catch (error) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = error.message;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'Failed to join the LIVE stream: $error';
        });
      }
    }
  }

  void _attachExistingVideoTrack() {
    for (final participant in _room.remoteParticipants.values) {
      for (final pub in participant.videoTrackPublications) {
        final track = pub.track;
        if (track != null) {
          _hostVideoTrack = track;
          return;
        }
      }
    }
  }

  Future<void> _leave() async {
    if (_hasJoined) {
      _hasJoined = false;
      try {
        await ref.read(liveRepositoryProvider).leave(widget.liveSessionId);
      } on AppException {
        // Best-effort — the server also expires stale viewers on its own.
      }
    }
    await _room.disconnect();
  }

  Future<void> _report() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Report this LIVE stream'),
        children: [
          _reportOption(context, 'SPAM', 'Spam'),
          _reportOption(context, 'NUDITY_OR_SEXUAL_CONTENT', 'Nudity or sexual content'),
          _reportOption(context, 'VIOLENCE', 'Violence'),
          _reportOption(context, 'HARASSMENT_OR_BULLYING', 'Harassment or bullying'),
          _reportOption(context, 'HATE_SPEECH', 'Hate speech'),
          _reportOption(context, 'MISINFORMATION', 'Misinformation'),
          _reportOption(context, 'OTHER', 'Other'),
        ],
      ),
    );
    if (reason == null || !mounted) return;

    try {
      await ref.read(liveRepositoryProvider).report(widget.liveSessionId, reason: reason);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report submitted. Thank you.')));
      }
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Widget _reportOption(BuildContext context, String value, String label) {
    return SimpleDialogOption(
      onPressed: () => Navigator.of(context).pop(value),
      child: Text(label),
    );
  }

  @override
  void dispose() {
    _viewerCountTimer?.cancel();
    _listener?.dispose();
    _leave();
    _room.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(child: _buildVideo()),
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
                    icon: const Icon(Icons.flag_outlined, color: Colors.white),
                    onPressed: _report,
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            if (_liveSession != null)
              Positioned(
                left: 12,
                bottom: 172,
                right: 12,
                child: Text(
                  _liveSession!.title,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: LiveChatPanel(liveSessionId: widget.liveSessionId),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVideo() {
    if (_isLoading) {
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
    if (_hostVideoTrack == null) {
      return const Center(
        child: Text('Waiting for the host\'s video…', style: TextStyle(color: Colors.white70)),
      );
    }
    return VideoTrackRenderer(_hostVideoTrack!);
  }
}
