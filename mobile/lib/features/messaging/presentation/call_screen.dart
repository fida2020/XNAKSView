import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/errors/app_exception.dart';
import 'messaging_providers.dart';

/// An active 1:1 voice or video call — real WebRTC via the same self-hosted
/// LiveKit server LIVE streaming uses (see routes/v1/calls.ts), not a fake
/// HTTP or prerecorded call. Both participants publish and subscribe in the
/// same room, unlike a LIVE session's host/viewer asymmetry.
class CallScreen extends ConsumerStatefulWidget {
  const CallScreen({
    super.key,
    required this.callId,
    required this.token,
    required this.wsUrl,
    required this.isVideo,
    this.otherUserName,
  });

  final String callId;
  final String token;
  final String wsUrl;
  final bool isVideo;
  final String? otherUserName;

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  late final Room _room;
  EventsListener<RoomEvent>? _listener;
  void Function()? _stopListeningEnded;
  void Function()? _stopListeningDeclined;
  void Function()? _stopListeningCancelled;

  bool _isConnecting = true;
  bool _isEnding = false;
  String? _error;
  bool _micEnabled = true;
  bool _cameraEnabled = true;
  VideoTrack? _remoteVideoTrack;

  @override
  void initState() {
    super.initState();
    _cameraEnabled = widget.isVideo;
    _room = Room();
    _listener = _room.createListener();
    _listener!
      ..on<RoomDisconnectedEvent>((_) {
        if (mounted && !_isEnding) setState(() => _error = 'Call connection lost.');
      })
      ..on<TrackSubscribedEvent>((event) {
        if (event.track is VideoTrack && mounted) setState(() => _remoteVideoTrack = event.track as VideoTrack);
      })
      ..on<TrackUnsubscribedEvent>((event) {
        if (mounted && event.track == _remoteVideoTrack) setState(() => _remoteVideoTrack = null);
      });

    final realtime = ref.read(realtimeClientProvider);
    _stopListeningEnded = realtime.on('call:ended', (_) => _closeOnRemoteAction());
    _stopListeningDeclined = realtime.on('call:declined', (_) => _closeOnRemoteAction());
    _stopListeningCancelled = realtime.on('call:cancelled', (_) => _closeOnRemoteAction());

    _connect();
  }

  void _closeOnRemoteAction() {
    if (!mounted || _isEnding) return;
    _isEnding = true;
    _room.disconnect();
    Navigator.of(context).pop();
  }

  Future<void> _connect() async {
    await Permission.microphone.request();
    if (widget.isVideo) await Permission.camera.request();

    try {
      await _room.connect(widget.wsUrl, widget.token);
      await _room.localParticipant?.setMicrophoneEnabled(true);
      if (widget.isVideo) await _room.localParticipant?.setCameraEnabled(true);
      if (mounted) setState(() => _isConnecting = false);
    } catch (error) {
      if (mounted) setState(() { _isConnecting = false; _error = 'Failed to connect: $error'; });
    }
  }

  Future<void> _toggleMic() async {
    _micEnabled = !_micEnabled;
    await _room.localParticipant?.setMicrophoneEnabled(_micEnabled);
    setState(() {});
  }

  Future<void> _toggleCamera() async {
    _cameraEnabled = !_cameraEnabled;
    await _room.localParticipant?.setCameraEnabled(_cameraEnabled);
    setState(() {});
  }

  Future<void> _flipCamera() async {
    for (final pub in _room.localParticipant?.videoTrackPublications ?? const []) {
      final track = pub.track;
      final options = track is LocalVideoTrack ? track.currentOptions : null;
      if (track is LocalVideoTrack && options is CameraCaptureOptions) {
        await track.setCameraPosition(
          options.cameraPosition == CameraPosition.front ? CameraPosition.back : CameraPosition.front,
        );
        return;
      }
    }
  }

  Future<void> _endCall() async {
    if (_isEnding) return;
    setState(() => _isEnding = true);
    try {
      await ref.read(messagingRepositoryProvider).endCall(widget.callId);
    } on AppException {
      // Even if the API call fails (e.g. the other side already ended it),
      // still tear down locally.
    } finally {
      await _room.disconnect();
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  void dispose() {
    _stopListeningEnded?.call();
    _stopListeningDeclined?.call();
    _stopListeningCancelled?.call();
    _listener?.dispose();
    _room.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _endCall();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Stack(
            children: [
              Positioned.fill(child: _buildRemoteView()),
              if (widget.isVideo && !_isConnecting)
                Positioned(
                  top: 16,
                  right: 16,
                  width: 100,
                  height: 140,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: _buildLocalPreview(),
                  ),
                ),
              Positioned(
                top: 16,
                left: 16,
                child: Text(widget.otherUserName ?? '', style: const TextStyle(color: Colors.white, fontSize: 18)),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 32,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _CallControlButton(icon: _micEnabled ? Icons.mic : Icons.mic_off, onPressed: _toggleMic),
                    const SizedBox(width: 16),
                    if (widget.isVideo) ...[
                      _CallControlButton(icon: _cameraEnabled ? Icons.videocam : Icons.videocam_off, onPressed: _toggleCamera),
                      const SizedBox(width: 16),
                      _CallControlButton(icon: Icons.cameraswitch, onPressed: _flipCamera),
                      const SizedBox(width: 16),
                    ],
                    _CallControlButton(icon: Icons.call_end, color: Colors.red, onPressed: _endCall),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRemoteView() {
    if (_isConnecting) return const Center(child: CircularProgressIndicator(color: Colors.white));
    if (_error != null) {
      return Center(child: Text(_error!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center));
    }
    if (!widget.isVideo || _remoteVideoTrack == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircleAvatar(radius: 48, child: Icon(Icons.person, size: 48)),
            const SizedBox(height: 12),
            Text(widget.otherUserName ?? 'Connecting…', style: const TextStyle(color: Colors.white)),
          ],
        ),
      );
    }
    return VideoTrackRenderer(_remoteVideoTrack!);
  }

  Widget _buildLocalPreview() {
    for (final pub in _room.localParticipant?.videoTrackPublications ?? const []) {
      if (pub.track is LocalVideoTrack) {
        return VideoTrackRenderer(pub.track as LocalVideoTrack, mirrorMode: VideoViewMirrorMode.mirror);
      }
    }
    return const ColoredBox(color: Colors.black54);
  }
}

class _CallControlButton extends StatelessWidget {
  const _CallControlButton({required this.icon, required this.onPressed, this.color});

  final IconData icon;
  final VoidCallback onPressed;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: 28,
      backgroundColor: color ?? Colors.white24,
      child: IconButton(icon: Icon(icon, color: Colors.white), onPressed: onPressed),
    );
  }
}
