import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/comment_model.dart';
import '../domain/video_model.dart';
import 'feed_controller.dart';
import 'video_providers.dart';

void showCommentSheet(
  BuildContext context,
  WidgetRef ref,
  VideoModel video,
  StateNotifierProvider<FeedController, FeedState> controllerProvider,
) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    builder: (context) => _CommentSheet(video: video, controllerProvider: controllerProvider),
  );
}

const _reportReasons = ['SPAM', 'NUDITY_OR_SEXUAL_CONTENT', 'VIOLENCE', 'HARASSMENT_OR_BULLYING', 'HATE_SPEECH', 'MISINFORMATION', 'OTHER'];

class _CommentSheet extends ConsumerStatefulWidget {
  const _CommentSheet({required this.video, required this.controllerProvider});

  final VideoModel video;
  final StateNotifierProvider<FeedController, FeedState> controllerProvider;

  @override
  ConsumerState<_CommentSheet> createState() => _CommentSheetState();
}

class _CommentSheetState extends ConsumerState<_CommentSheet> {
  final _textController = TextEditingController();
  final List<CommentModel> _comments = [];
  CommentModel? _pinned;
  final Map<String, List<CommentModel>> _repliesByParent = {};
  final Set<String> _expandedReplies = {};
  String? _replyingToId;
  bool _isLoading = true;
  bool _isSubmitting = false;
  String? _error;

  bool get _isVideoOwner => widget.video.userId == ref.read(authControllerProvider).userId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await ref.read(videoRepositoryProvider).fetchComments(widget.video.id);
      if (!mounted) return;
      setState(() {
        _comments
          ..clear()
          ..addAll(page.comments);
        _pinned = page.pinned;
        _isLoading = false;
      });
    } on AppException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _isLoading = false;
      });
    }
  }

  Future<void> _submit() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _isSubmitting) return;

    setState(() => _isSubmitting = true);
    final parentId = _replyingToId;
    try {
      final comment = await ref.read(videoRepositoryProvider).createComment(widget.video.id, text, parentId: parentId);
      if (!mounted) return;
      setState(() {
        if (parentId != null) {
          (_repliesByParent[parentId] ??= []).add(comment);
          final idx = _comments.indexWhere((c) => c.id == parentId);
          if (idx != -1) _comments[idx] = _comments[idx].copyWith(replyCount: _comments[idx].replyCount + 1);
          _expandedReplies.add(parentId);
        } else {
          _comments.insert(0, comment);
        }
        _textController.clear();
        _replyingToId = null;
      });
      ref.read(widget.controllerProvider.notifier).applyCommentAdded(widget.video.id);
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _delete(CommentModel comment) async {
    try {
      await ref.read(videoRepositoryProvider).deleteComment(comment.id);
      if (!mounted) return;
      setState(() {
        _comments.removeWhere((c) => c.id == comment.id);
        _repliesByParent[comment.parentId]?.removeWhere((c) => c.id == comment.id);
        if (_pinned?.id == comment.id) _pinned = null;
      });
      ref.read(widget.controllerProvider.notifier).applyCommentRemoved(widget.video.id);
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _toggleLike(CommentModel comment) async {
    final wasLiked = comment.likedByMe;
    _replaceComment(comment.id, (c) => c.copyWith(likedByMe: !wasLiked, likeCount: c.likeCount + (wasLiked ? -1 : 1)));
    try {
      final repository = ref.read(videoRepositoryProvider);
      if (wasLiked) {
        await repository.unlikeComment(comment.id);
      } else {
        await repository.likeComment(comment.id);
      }
    } on AppException {
      _replaceComment(comment.id, (c) => c.copyWith(likedByMe: wasLiked, likeCount: comment.likeCount));
    }
  }

  Future<void> _togglePin(CommentModel comment) async {
    final repository = ref.read(videoRepositoryProvider);
    try {
      if (_pinned?.id == comment.id) {
        await repository.unpinComment(comment.id);
        if (mounted) setState(() => _pinned = null);
      } else {
        await repository.pinComment(comment.id);
        if (mounted) setState(() => _pinned = comment);
      }
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _report(CommentModel comment) async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final reason in _reportReasons)
              ListTile(title: Text(reason.replaceAll('_', ' ')), onTap: () => Navigator.of(context).pop(reason)),
          ],
        ),
      ),
    );
    if (reason == null) return;
    try {
      await ref.read(videoRepositoryProvider).reportComment(comment.id, reason: reason);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reported. Thank you.')));
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _toggleReplies(CommentModel comment) async {
    if (_expandedReplies.contains(comment.id)) {
      setState(() => _expandedReplies.remove(comment.id));
      return;
    }
    setState(() => _expandedReplies.add(comment.id));
    if (_repliesByParent.containsKey(comment.id)) return;
    try {
      final replies = await ref.read(videoRepositoryProvider).fetchReplies(comment.id);
      if (mounted) setState(() => _repliesByParent[comment.id] = replies);
    } on AppException {
      // Leave collapsed-looking (empty) on failure rather than blocking the sheet.
    }
  }

  void _replaceComment(String id, CommentModel Function(CommentModel) update) {
    setState(() {
      final topIdx = _comments.indexWhere((c) => c.id == id);
      if (topIdx != -1) _comments[topIdx] = update(_comments[topIdx]);
      if (_pinned?.id == id) _pinned = update(_pinned!);
      for (final entry in _repliesByParent.entries) {
        final idx = entry.value.indexWhere((c) => c.id == id);
        if (idx != -1) entry.value[idx] = update(entry.value[idx]);
      }
    });
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currentUserId = ref.watch(authControllerProvider).userId;

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('Comments', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
              const Divider(height: 1),
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator())
                    : _error != null
                        ? Center(child: Text(_error!))
                        : (_comments.isEmpty && _pinned == null)
                            ? const Center(child: Text('No comments yet — be the first!'))
                            : ListView(
                                controller: scrollController,
                                children: [
                                  if (_pinned != null) _buildCommentTile(_pinned!, currentUserId, pinnedBadge: true),
                                  for (final comment in _comments.where((c) => c.id != _pinned?.id))
                                    _buildCommentWithReplies(comment, currentUserId),
                                ],
                              ),
              ),
              const Divider(height: 1),
              if (_replyingToId != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      const Text('Replying…', style: TextStyle(fontStyle: FontStyle.italic)),
                      const Spacer(),
                      TextButton(onPressed: () => setState(() => _replyingToId = null), child: const Text('Cancel')),
                    ],
                  ),
                ),
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _textController,
                          maxLength: 500,
                          decoration: const InputDecoration(hintText: 'Add a comment…', border: OutlineInputBorder(), counterText: ''),
                        ),
                      ),
                      IconButton(
                        icon: _isSubmitting
                            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.send),
                        onPressed: _isSubmitting ? null : _submit,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildCommentWithReplies(CommentModel comment, String? currentUserId) {
    final replies = _repliesByParent[comment.id] ?? [];
    final expanded = _expandedReplies.contains(comment.id);
    return Column(
      children: [
        _buildCommentTile(comment, currentUserId),
        if (comment.replyCount > 0)
          Padding(
            padding: const EdgeInsets.only(left: 56),
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _toggleReplies(comment),
                child: Text(expanded ? 'Hide replies' : 'View ${comment.replyCount} replies'),
              ),
            ),
          ),
        if (expanded)
          for (final reply in replies)
            Padding(padding: const EdgeInsets.only(left: 40), child: _buildCommentTile(reply, currentUserId)),
      ],
    );
  }

  Widget _buildCommentTile(CommentModel comment, String? currentUserId, {bool pinnedBadge = false}) {
    final isMine = comment.userId == currentUserId;
    return ListTile(
      title: Row(
        children: [
          Flexible(child: Text(comment.authorLabel, style: const TextStyle(fontWeight: FontWeight.w600))),
          if (pinnedBadge) ...[
            const SizedBox(width: 6),
            const Icon(Icons.push_pin, size: 14),
          ],
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(comment.text),
          Row(
            children: [
              TextButton(
                onPressed: () => setState(() => _replyingToId = comment.id),
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 32)),
                child: const Text('Reply'),
              ),
              if (_isVideoOwner && comment.parentId == null)
                TextButton(
                  onPressed: () => _togglePin(comment),
                  style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 32)),
                  child: Text(pinnedBadge ? 'Unpin' : 'Pin'),
                ),
              TextButton(
                onPressed: () => _report(comment),
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 32)),
                child: const Text('Report'),
              ),
            ],
          ),
        ],
      ),
      trailing: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: Icon(comment.likedByMe ? Icons.favorite : Icons.favorite_border, size: 18, color: comment.likedByMe ? Colors.red : null),
            onPressed: () => _toggleLike(comment),
          ),
          if (comment.likeCount > 0) Text('${comment.likeCount}', style: const TextStyle(fontSize: 11)),
          if (isMine)
            IconButton(icon: const Icon(Icons.delete_outline, size: 18), onPressed: () => _delete(comment)),
        ],
      ),
    );
  }
}
