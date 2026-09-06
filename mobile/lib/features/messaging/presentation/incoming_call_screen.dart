import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import 'messaging_providers.dart';

/// Full-screen ringing UI shown when `call:incoming` arrives over the
/// realtime gateway (see features/messaging/presentation/call_listener.dart
/// for what pushes this route). The callee's LiveKit token is only issued
/// on accept — receiving this screen does not by itself grant any room
/// access.
class IncomingCallScreen extends ConsumerStatefulWidget {
  const IncomingCallScreen({super.key, required this.callId, this.callerName});

  final String callId;
  final String? callerName;

  @override
  ConsumerState<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends ConsumerState<IncomingCallScreen> {
  bool _isResponding = false;
  void Function()? _stopListeningCancelled;

  @override
  void initState() {
    super.initState();
    _stopListeningCancelled = ref.read(realtimeClientProvider).on('call:cancelled', (payload) {
      final map = Map<String, dynamic>.from(payload as Map);
      if (map['callId'] == widget.callId && mounted) Navigator.of(context).pop();
    });
  }

  @override
  void dispose() {
    _stopListeningCancelled?.call();
    super.dispose();
  }

  Future<void> _accept() async {
    if (_isResponding) return;
    setState(() => _isResponding = true);
    try {
      final info = await ref.read(messagingRepositoryProvider).acceptCall(widget.callId);
      if (!mounted) return;
      Navigator.of(context).pop();
      context.pushActiveCall(
        callId: widget.callId,
        token: info.token,
        wsUrl: info.wsUrl,
        otherUserName: widget.callerName,
      );
    } on AppException catch (error) {
      if (mounted) {
        setState(() => _isResponding = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _decline() async {
    if (_isResponding) return;
    setState(() => _isResponding = true);
    try {
      await ref.read(messagingRepositoryProvider).declineCall(widget.callId);
    } on AppException {
      // Best-effort — either way, leave this screen.
    } finally {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: Colors.black87,
        body: SafeArea(
          child: Column(
            children: [
              const Spacer(),
              const CircleAvatar(radius: 56, child: Icon(Icons.person, size: 56)),
              const SizedBox(height: 16),
              Text(widget.callerName ?? 'Unknown caller', style: const TextStyle(color: Colors.white, fontSize: 22)),
              const SizedBox(height: 8),
              const Text('Incoming voice call…', style: TextStyle(color: Colors.white70)),
              const Spacer(),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 32),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _ActionButton(icon: Icons.call_end, color: Colors.red, label: 'Decline', onPressed: _decline),
                    _ActionButton(icon: Icons.call, color: Colors.green, label: 'Accept', onPressed: _accept),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.icon, required this.color, required this.label, required this.onPressed});

  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        CircleAvatar(radius: 32, backgroundColor: color, child: IconButton(icon: Icon(icon, color: Colors.white), onPressed: onPressed)),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: Colors.white)),
      ],
    );
  }
}
