import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../../core/router/app_router.dart';
import '../domain/conversation_model.dart';
import '../domain/message_model.dart';
import 'messaging_providers.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  ConversationModel? _conversation;
  final List<MessageModel> _messages = [];
  String? _nextCursor;
  bool _isLoading = true;
  bool _isSending = false;
  bool _otherTyping = false;
  Timer? _typingClearTimer;
  final _textController = TextEditingController();
  final List<void Function()> _unsubscribers = [];
  String? _myUserId;
  final _audioRecorder = AudioRecorder();
  final _audioPlayer = AudioPlayer();
  bool _isRecording = false;
  String? _playingMessageId;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    _myUserId = ref.read(authControllerProvider).userId;
    final repo = ref.read(messagingRepositoryProvider);
    final realtime = ref.read(realtimeClientProvider);
    realtime.joinConversation(widget.conversationId);

    _unsubscribers.addAll([
      realtime.on('message:new', _onMessageNew),
      realtime.on('message:deleted', _onMessageDeleted),
      realtime.on('message:read', _onMessageRead),
      realtime.on('conversation:typing', _onTyping),
      realtime.on('presence:update', _onPresence),
    ]);

    try {
      final conversation = await repo.fetchConversation(widget.conversationId);
      final page = await repo.listMessages(widget.conversationId);
      await repo.markConversationRead(widget.conversationId);
      if (!mounted) return;
      setState(() {
        _conversation = conversation;
        _messages.addAll(page.messages);
        _nextCursor = page.nextCursor;
        _isLoading = false;
      });
    } on AppException catch (error) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  void _onMessageNew(dynamic payload) {
    final message = MessageModel.fromJson(Map<String, dynamic>.from(payload as Map));
    if (message.conversationId != widget.conversationId) return;
    if (_messages.any((m) => m.id == message.id)) return;
    setState(() => _messages.insert(0, message));
    if (message.senderId != _myUserId) {
      ref.read(messagingRepositoryProvider).markConversationRead(widget.conversationId);
    }
  }

  void _onMessageDeleted(dynamic payload) {
    final map = Map<String, dynamic>.from(payload as Map);
    if (map['conversationId'] != widget.conversationId) return;
    final index = _messages.indexWhere((m) => m.id == map['messageId']);
    if (index == -1) return;
    setState(() {
      _messages[index] = MessageModel(
        id: _messages[index].id,
        conversationId: _messages[index].conversationId,
        senderId: _messages[index].senderId,
        type: _messages[index].type,
        clientMessageId: _messages[index].clientMessageId,
        deleted: true,
        createdAt: _messages[index].createdAt,
      );
    });
  }

  void _onMessageRead(dynamic payload) {
    final map = Map<String, dynamic>.from(payload as Map);
    if (map['conversationId'] != widget.conversationId) return;
    setState(() {
      for (var i = 0; i < _messages.length; i++) {
        if (_messages[i].senderId == _myUserId) {
          _messages[i] = MessageModel(
            id: _messages[i].id,
            conversationId: _messages[i].conversationId,
            senderId: _messages[i].senderId,
            type: _messages[i].type,
            text: _messages[i].text,
            voiceUrl: _messages[i].voiceUrl,
            voiceDurationMs: _messages[i].voiceDurationMs,
            clientMessageId: _messages[i].clientMessageId,
            deleted: _messages[i].deleted,
            createdAt: _messages[i].createdAt,
            receipts: [
              ...(_messages[i].receipts.where((r) => r.userId != map['readerId'])),
              MessageReceipt(userId: map['readerId'] as String, readAt: DateTime.now(), deliveredAt: DateTime.now()),
            ],
          );
        }
      }
    });
  }

  void _onTyping(dynamic payload) {
    final map = Map<String, dynamic>.from(payload as Map);
    if (map['conversationId'] != widget.conversationId || map['userId'] == _myUserId) return;
    _typingClearTimer?.cancel();
    setState(() => _otherTyping = true);
    _typingClearTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _otherTyping = false);
    });
  }

  void _onPresence(dynamic payload) {
    final map = Map<String, dynamic>.from(payload as Map);
    final other = _conversation?.otherUser;
    if (other == null || map['userId'] != other.id) return;
    setState(() {
      _conversation = _conversation!.copyWith(
        presence: ConversationPresence(
          online: map['online'] as bool,
          lastActiveAt: map['lastActiveAt'] == null ? null : DateTime.parse(map['lastActiveAt'] as String),
        ),
      );
    });
  }

  Future<void> _loadMore() async {
    if (_nextCursor == null) return;
    final page = await ref.read(messagingRepositoryProvider).listMessages(widget.conversationId, cursor: _nextCursor);
    if (!mounted) return;
    setState(() {
      _messages.addAll(page.messages);
      _nextCursor = page.nextCursor;
    });
  }

  Future<void> _sendText() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _isSending) return;
    setState(() => _isSending = true);
    _textController.clear();
    try {
      final message = await ref.read(messagingRepositoryProvider).sendTextMessage(
            widget.conversationId,
            clientMessageId: _generateId(),
            text: text,
          );
      if (mounted && !_messages.any((m) => m.id == message.id)) {
        setState(() => _messages.insert(0, message));
      }
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  void _onComposerChanged(String _) {
    ref.read(realtimeClientProvider).sendTyping(widget.conversationId);
  }

  Future<void> _startRecording() async {
    if (!await _audioRecorder.hasPermission()) return;
    final dir = Directory.systemTemp;
    final path = '${dir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _audioRecorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    setState(() => _isRecording = true);
  }

  Future<void> _stopRecordingAndSend() async {
    final path = await _audioRecorder.stop();
    setState(() => _isRecording = false);
    if (path == null) return;

    try {
      final message = await ref.read(messagingRepositoryProvider).sendVoiceMessage(
            widget.conversationId,
            clientMessageId: _generateId(),
            audioFile: File(path),
          );
      if (mounted && !_messages.any((m) => m.id == message.id)) {
        setState(() => _messages.insert(0, message));
      }
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _cancelRecording() async {
    await _audioRecorder.cancel();
    setState(() => _isRecording = false);
  }

  Future<void> _playVoice(MessageModel message) async {
    if (message.voiceUrl == null) return;
    try {
      if (_playingMessageId == message.id) {
        await _audioPlayer.stop();
        setState(() => _playingMessageId = null);
        return;
      }
      final token = await ref.read(secureStorageProvider).read(StorageKeys.accessToken);
      final uri = AppConfig.resolveMediaUrl(message.voiceUrl!);
      await _audioPlayer.setAudioSource(
        AudioSource.uri(uri, headers: token == null ? null : {'Authorization': 'Bearer $token'}),
      );
      setState(() => _playingMessageId = message.id);
      await _audioPlayer.play();
      _audioPlayer.playerStateStream.firstWhere((s) => s.processingState == ProcessingState.completed).then((_) {
        if (mounted) setState(() => _playingMessageId = null);
      });
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _startCall() async {
    final other = _conversation?.otherUser;
    if (other == null) return;
    try {
      final info = await ref.read(messagingRepositoryProvider).initiateCall(other.id);
      if (!mounted) return;
      context.pushActiveCall(
        callId: info.call.id,
        token: info.token,
        wsUrl: info.wsUrl,
        otherUserName: other.displayLabel,
      );
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  void _showConversationMenu() {
    final other = _conversation?.otherUser;
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.block),
              title: const Text('Block user'),
              onTap: () async {
                Navigator.of(context).pop();
                if (other != null) await ref.read(messagingRepositoryProvider).blockUser(other.id);
                if (context.mounted) Navigator.of(context).pop();
              },
            ),
            ListTile(
              leading: const Icon(Icons.flag_outlined),
              title: const Text('Report conversation'),
              onTap: () async {
                Navigator.of(context).pop();
                await ref.read(messagingRepositoryProvider).reportConversation(widget.conversationId, reason: 'OTHER');
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reported. Thank you.')));
                }
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    ref.read(realtimeClientProvider).leaveConversation(widget.conversationId);
    for (final unsubscribe in _unsubscribers) {
      unsubscribe();
    }
    _typingClearTimer?.cancel();
    _textController.dispose();
    _audioRecorder.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final other = _conversation?.otherUser;
    final presence = _conversation?.presence;

    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onTap: _showConversationMenu,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(other?.displayLabel ?? '...'),
              if (_otherTyping)
                const Text('typing…', style: TextStyle(fontSize: 12))
              else if (presence != null)
                Text(presence.online ? 'Online' : _lastActiveLabel(presence.lastActiveAt), style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.call_outlined), onPressed: _startCall),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                Expanded(
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (notification) {
                      if (notification.metrics.pixels >= notification.metrics.maxScrollExtent - 200) {
                        _loadMore();
                      }
                      return false;
                    },
                    child: ListView.builder(
                      reverse: true,
                      padding: const EdgeInsets.all(12),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) => _MessageBubble(
                        message: _messages[index],
                        isMine: _messages[index].senderId == _myUserId,
                        isPlaying: _playingMessageId == _messages[index].id,
                        onPlayVoice: () => _playVoice(_messages[index]),
                        onLongPress: () => _showMessageActions(_messages[index]),
                      ),
                    ),
                  ),
                ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: _isRecording
                        ? Row(
                            children: [
                              const Icon(Icons.mic, color: Colors.red),
                              const SizedBox(width: 8),
                              const Expanded(child: Text('Recording…')),
                              IconButton(icon: const Icon(Icons.close), onPressed: _cancelRecording),
                              IconButton(icon: const Icon(Icons.send), onPressed: _stopRecordingAndSend),
                            ],
                          )
                        : Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _textController,
                                  maxLength: 2000,
                                  onChanged: _onComposerChanged,
                                  decoration: const InputDecoration(hintText: 'Message…', counterText: '', border: OutlineInputBorder()),
                                  onSubmitted: (_) => _sendText(),
                                ),
                              ),
                              IconButton(icon: const Icon(Icons.mic_none), onPressed: _startRecording),
                              IconButton(icon: const Icon(Icons.send), onPressed: _isSending ? null : _sendText),
                            ],
                          ),
                  ),
                ),
              ],
            ),
    );
  }

  void _showMessageActions(MessageModel message) {
    final isMine = message.senderId == _myUserId;
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isMine)
              ListTile(
                leading: const Icon(Icons.delete_outline),
                title: const Text('Unsend'),
                onTap: () async {
                  Navigator.of(context).pop();
                  await ref.read(messagingRepositoryProvider).unsendMessage(message.id);
                },
              ),
            if (!isMine)
              ListTile(
                leading: const Icon(Icons.flag_outlined),
                title: const Text('Report message'),
                onTap: () async {
                  Navigator.of(context).pop();
                  await ref.read(messagingRepositoryProvider).reportMessage(message.id, reason: 'OTHER');
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reported. Thank you.')));
                  }
                },
              ),
          ],
        ),
      ),
    );
  }
}

String _generateId() {
  final random = DateTime.now().microsecondsSinceEpoch;
  return '${random.toRadixString(16)}-${(random * 7919) % 1000000}';
}

String _lastActiveLabel(DateTime? lastActiveAt) {
  if (lastActiveAt == null) return '';
  final diff = DateTime.now().difference(lastActiveAt);
  if (diff.inMinutes < 1) return 'Active just now';
  if (diff.inMinutes < 60) return 'Active ${diff.inMinutes}m ago';
  if (diff.inHours < 24) return 'Active ${diff.inHours}h ago';
  return 'Active ${diff.inDays}d ago';
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    required this.isMine,
    required this.isPlaying,
    required this.onPlayVoice,
    required this.onLongPress,
  });

  final MessageModel message;
  final bool isMine;
  final bool isPlaying;
  final VoidCallback onPlayVoice;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final isRead = message.receipts.any((r) => r.readAt != null);
    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
          decoration: BoxDecoration(
            color: isMine ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (message.deleted)
                Text('Message deleted', style: TextStyle(fontStyle: FontStyle.italic, color: isMine ? Colors.white70 : null))
              else if (message.type == MessageType.voice)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: Icon(isPlaying ? Icons.stop_circle_outlined : Icons.play_circle_outline),
                      color: isMine ? Colors.white : null,
                      onPressed: onPlayVoice,
                    ),
                    Text(
                      '${((message.voiceDurationMs ?? 0) / 1000).round()}s',
                      style: TextStyle(color: isMine ? Colors.white : null),
                    ),
                  ],
                )
              else
                Text(message.text ?? '', style: TextStyle(color: isMine ? Colors.white : null)),
              if (isMine && !message.deleted)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Icon(isRead ? Icons.done_all : Icons.done, size: 14, color: Colors.white70),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
