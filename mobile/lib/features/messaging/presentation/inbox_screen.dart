import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../domain/conversation_model.dart';
import 'messaging_providers.dart';

/// The conversation list — pinned conversations first, then the rest
/// ordered by most recent activity. A conversation only appears here once
/// it has at least one message (see backend routes/v1/conversations.ts).
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  List<ConversationModel> _pinned = [];
  List<ConversationModel> _conversations = [];
  String? _nextCursor;
  bool _isLoading = true;
  String? _error;
  void Function()? _stopListening;

  @override
  void initState() {
    super.initState();
    _load();
    _stopListening = ref.read(realtimeClientProvider).on('message:new', (_) => _load());
  }

  Future<void> _load() async {
    try {
      final page = await ref.read(messagingRepositoryProvider).listConversations();
      if (!mounted) return;
      setState(() {
        _pinned = page.pinned;
        _conversations = page.conversations;
        _nextCursor = page.nextCursor;
        _isLoading = false;
        _error = null;
      });
    } on AppException catch (error) {
      if (mounted) setState(() { _isLoading = false; _error = error.message; });
    }
  }

  Future<void> _loadMore() async {
    if (_nextCursor == null) return;
    final page = await ref.read(messagingRepositoryProvider).listConversations(cursor: _nextCursor);
    if (!mounted) return;
    setState(() {
      _conversations = [..._conversations, ...page.conversations];
      _nextCursor = page.nextCursor;
    });
  }

  @override
  void dispose() {
    _stopListening?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Messages'),
        actions: [
          IconButton(icon: const Icon(Icons.call_outlined), tooltip: 'Call history', onPressed: () => context.pushCallHistory()),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    children: [
                      if (_pinned.isNotEmpty) ...[
                        const Padding(
                          padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                          child: Text('Pinned', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                        ),
                        for (final conversation in _pinned) _ConversationTile(conversation: conversation, onChanged: _load),
                        const Divider(height: 1),
                      ],
                      for (final conversation in _conversations) _ConversationTile(conversation: conversation, onChanged: _load),
                      if (_nextCursor != null)
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Center(child: TextButton(onPressed: _loadMore, child: const Text('Load more'))),
                        ),
                      if (_pinned.isEmpty && _conversations.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(32),
                          child: Center(child: Text('No conversations yet.')),
                        ),
                    ],
                  ),
                ),
    );
  }
}

class _ConversationTile extends ConsumerWidget {
  const _ConversationTile({required this.conversation, required this.onChanged});

  final ConversationModel conversation;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final other = conversation.otherUser;
    final isRequest = conversation.status == ConversationRequestStatus.pending;

    return ListTile(
      leading: CircleAvatar(
        backgroundImage: other?.avatarUrl != null ? NetworkImage(other!.avatarUrl!) : null,
        child: other?.avatarUrl == null ? Text((other?.displayLabel ?? '?').characters.first.toUpperCase()) : null,
      ),
      title: Text(other?.displayLabel ?? 'Unknown', style: TextStyle(fontWeight: conversation.unreadCount > 0 ? FontWeight.bold : FontWeight.normal)),
      subtitle: Text(
        isRequest ? 'Message request' : (conversation.lastMessagePreview ?? ''),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (conversation.muted) const Icon(Icons.notifications_off_outlined, size: 16, color: Colors.grey),
          if (conversation.unreadCount > 0)
            Container(
              margin: const EdgeInsets.only(top: 4),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, borderRadius: BorderRadius.circular(10)),
              child: Text('${conversation.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 11)),
            ),
        ],
      ),
      onTap: () => context.pushChat(conversation.id),
      onLongPress: () => _showActions(context, ref),
    );
  }

  void _showActions(BuildContext context, WidgetRef ref) {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(conversation.pinned ? Icons.push_pin : Icons.push_pin_outlined),
              title: Text(conversation.pinned ? 'Unpin' : 'Pin'),
              onTap: () async {
                Navigator.of(context).pop();
                await ref.read(messagingRepositoryProvider).setPinned(conversation.id, !conversation.pinned);
                onChanged();
              },
            ),
            ListTile(
              leading: Icon(conversation.muted ? Icons.notifications_active_outlined : Icons.notifications_off_outlined),
              title: Text(conversation.muted ? 'Unmute' : 'Mute'),
              onTap: () async {
                Navigator.of(context).pop();
                await ref.read(messagingRepositoryProvider).setMuted(conversation.id, !conversation.muted);
                onChanged();
              },
            ),
            ListTile(
              leading: const Icon(Icons.flag_outlined),
              title: const Text('Report conversation'),
              onTap: () async {
                Navigator.of(context).pop();
                await ref.read(messagingRepositoryProvider).reportConversation(conversation.id, reason: 'OTHER');
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
