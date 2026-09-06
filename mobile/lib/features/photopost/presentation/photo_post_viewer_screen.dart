import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/photo_post_model.dart';
import 'photo_post_providers.dart';

const _reportReasons = ['SPAM', 'NUDITY_OR_SEXUAL_CONTENT', 'VIOLENCE', 'HARASSMENT_OR_BULLYING', 'HATE_SPEECH', 'MISINFORMATION', 'OTHER'];

/// Photo post / carousel viewer (Step 6, brief A) — manual swipe through
/// 2-35 images (current TikTok Photo Mode; images never auto-advance).
class PhotoPostViewerScreen extends ConsumerStatefulWidget {
  const PhotoPostViewerScreen({super.key, required this.photoPostId});

  final String photoPostId;

  @override
  ConsumerState<PhotoPostViewerScreen> createState() => _PhotoPostViewerScreenState();
}

class _PhotoPostViewerScreenState extends ConsumerState<PhotoPostViewerScreen> {
  PhotoPostModel? _post;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final post = await ref.read(photoPostRepositoryProvider).fetchOne(widget.photoPostId);
      if (mounted) setState(() => _post = post);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleLike() async {
    final post = _post;
    if (post == null) return;
    final repository = ref.read(photoPostRepositoryProvider);
    try {
      if (post.likedByMe) {
        await repository.unlike(post.id);
      } else {
        await repository.like(post.id);
      }
      await _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _delete() async {
    final post = _post;
    if (post == null) return;
    await ref.read(photoPostRepositoryProvider).delete(post.id);
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  Future<void> _report() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [for (final r in _reportReasons) ListTile(title: Text(r.replaceAll('_', ' ')), onTap: () => Navigator.of(context).pop(r))],
        ),
      ),
    );
    if (reason == null) return;
    try {
      await ref.read(photoPostRepositoryProvider).report(widget.photoPostId, reason: reason);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reported. Thank you.')));
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _showComments() async {
    final comments = await ref.read(photoPostRepositoryProvider).fetchComments(widget.photoPostId);
    if (!mounted) return;
    final textController = TextEditingController();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        expand: false,
        builder: (context, scrollController) => Column(
          children: [
            Expanded(
              child: ListView.builder(
                controller: scrollController,
                itemCount: comments.length,
                itemBuilder: (context, index) {
                  final c = comments[index];
                  return ListTile(title: Text(c['displayName'] as String? ?? c['username'] as String? ?? 'User'), subtitle: Text(c['text'] as String));
                },
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Row(
                  children: [
                    Expanded(child: TextField(controller: textController, decoration: const InputDecoration(hintText: 'Add a comment…'))),
                    IconButton(
                      icon: const Icon(Icons.send),
                      onPressed: () async {
                        final text = textController.text.trim();
                        if (text.isEmpty) return;
                        await ref.read(photoPostRepositoryProvider).addComment(widget.photoPostId, text);
                        if (context.mounted) Navigator.of(context).pop();
                      },
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final post = _post;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        actions: [
          if (post != null && post.userId == ref.read(authControllerProvider).userId)
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: _delete,
            ),
          IconButton(icon: const Icon(Icons.flag_outlined), onPressed: _report),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.white)))
              : Stack(
                  children: [
                    PageView.builder(
                      itemCount: post!.photos.length,
                      itemBuilder: (context, index) => _AuthenticatedPhoto(url: post.photos[index].url),
                    ),
                    Positioned(
                      left: 16,
                      right: 16,
                      bottom: 24,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (post.author != null)
                            Text(post.author!.displayLabel, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          if (post.caption != null && post.caption!.isNotEmpty)
                            Text(post.caption!, style: const TextStyle(color: Colors.white)),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              IconButton(
                                icon: Icon(post.likedByMe ? Icons.favorite : Icons.favorite_border, color: post.likedByMe ? Colors.red : Colors.white),
                                onPressed: _toggleLike,
                              ),
                              Text('${post.likeCount}', style: const TextStyle(color: Colors.white)),
                              const SizedBox(width: 16),
                              IconButton(icon: const Icon(Icons.mode_comment_outlined, color: Colors.white), onPressed: _showComments),
                              Text('${post.commentCount}', style: const TextStyle(color: Colors.white)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _AuthenticatedPhoto extends ConsumerWidget {
  const _AuthenticatedPhoto({required this.url});

  final String url;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<String?>(
      future: ref.read(secureStorageProvider).read(StorageKeys.accessToken),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox.shrink();
        final uri = AppConfig.resolveMediaUrl(url);
        return Image.network(
          uri.toString(),
          headers: {'Authorization': 'Bearer ${snapshot.data}'},
          fit: BoxFit.contain,
          errorBuilder: (context, error, stackTrace) => const Center(child: Icon(Icons.broken_image, color: Colors.white54)),
        );
      },
    );
  }
}
