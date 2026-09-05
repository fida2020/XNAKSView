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
  bool _isLoading = true;
  bool _isSubmitting = false;
  String? _error;

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
    try {
      final comment = await ref.read(videoRepositoryProvider).createComment(widget.video.id, text);
      if (!mounted) return;
      setState(() {
        _comments.insert(0, comment);
        _textController.clear();
      });
      ref.read(widget.controllerProvider.notifier).applyCommentAdded(widget.video.id);
    } on AppException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _delete(CommentModel comment) async {
    try {
      await ref.read(videoRepositoryProvider).deleteComment(comment.id);
      if (!mounted) return;
      setState(() => _comments.removeWhere((c) => c.id == comment.id));
      ref.read(widget.controllerProvider.notifier).applyCommentRemoved(widget.video.id);
    } on AppException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
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
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.9,
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
                        : _comments.isEmpty
                            ? const Center(child: Text('No comments yet — be the first!'))
                            : ListView.builder(
                                controller: scrollController,
                                itemCount: _comments.length,
                                itemBuilder: (context, index) {
                                  final comment = _comments[index];
                                  final isMine = comment.userId == currentUserId;
                                  return ListTile(
                                    title: Text(comment.authorLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                                    subtitle: Text(comment.text),
                                    trailing: isMine
                                        ? IconButton(
                                            icon: const Icon(Icons.delete_outline, size: 20),
                                            onPressed: () => _delete(comment),
                                          )
                                        : null,
                                  );
                                },
                              ),
              ),
              const Divider(height: 1),
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
}
