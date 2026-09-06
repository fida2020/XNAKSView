import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/live_chat_message_model.dart';
import 'live_providers.dart';

/// Scrollable chat log + input, overlaid at the bottom of the LIVE room for
/// both host and viewer. Polls for new messages rather than a push
/// subscription — a real-time chat channel (e.g. over LiveKit's own data
/// track) is a natural upgrade, not built here (see docs/STEP4_PROGRESS.md).
class LiveChatPanel extends ConsumerStatefulWidget {
  const LiveChatPanel({super.key, required this.liveSessionId});

  final String liveSessionId;

  @override
  ConsumerState<LiveChatPanel> createState() => _LiveChatPanelState();
}

class _LiveChatPanelState extends ConsumerState<LiveChatPanel> {
  final _textController = TextEditingController();
  final List<LiveChatMessageModel> _messages = [];
  bool _isSending = false;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) => _load());
  }

  Future<void> _load() async {
    try {
      final messages = await ref.read(liveRepositoryProvider).fetchChat(widget.liveSessionId);
      if (mounted) {
        setState(() {
          _messages
            ..clear()
            ..addAll(messages.reversed);
        });
      }
    } on AppException {
      // Best-effort background refresh — a transient failure here shouldn't
      // interrupt the viewer/host experience.
    }
  }

  Future<void> _send() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _isSending) return;

    setState(() => _isSending = true);
    try {
      await ref.read(liveRepositoryProvider).sendChatMessage(widget.liveSessionId, text);
      _textController.clear();
      await _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 160,
          child: ListView.builder(
            reverse: true,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: _messages.length,
            itemBuilder: (context, index) {
              final message = _messages[_messages.length - 1 - index];
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: RichText(
                  text: TextSpan(
                    style: const TextStyle(color: Colors.white, shadows: [Shadow(blurRadius: 4, color: Colors.black87)]),
                    children: [
                      TextSpan(text: '${message.authorLabel}  ', style: const TextStyle(fontWeight: FontWeight.bold)),
                      TextSpan(text: message.text),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _textController,
                  maxLength: 300,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'Say something…',
                    hintStyle: const TextStyle(color: Colors.white70),
                    counterText: '',
                    filled: true,
                    fillColor: Colors.black45,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide.none),
                  ),
                  onSubmitted: (_) => _send(),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.send, color: Colors.white),
                onPressed: _isSending ? null : _send,
              ),
            ],
          ),
        ),
      ],
    );
  }
}
