import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/text_post_model.dart';
import 'text_post_providers.dart';

const _backgroundStyles = <String, Color>{
  'plain': Colors.black,
  'gradient-1': Color(0xFF6A11CB),
  'gradient-2': Color(0xFFEF3B36),
  'gradient-3': Color(0xFF1D976C),
};

class TextPostDetailScreen extends ConsumerStatefulWidget {
  const TextPostDetailScreen({super.key, required this.post});

  final TextPostModel post;

  @override
  ConsumerState<TextPostDetailScreen> createState() => _TextPostDetailScreenState();
}

class _TextPostDetailScreenState extends ConsumerState<TextPostDetailScreen> {
  late TextPostModel _post = widget.post;

  Future<void> _toggleLike() async {
    final repository = ref.read(textPostRepositoryProvider);
    try {
      if (_post.likedByMe) {
        await repository.unlike(_post.id);
      } else {
        await repository.like(_post.id);
      }
      setState(() {
        _post = TextPostModel(
          id: _post.id,
          userId: _post.userId,
          text: _post.text,
          backgroundStyle: _post.backgroundStyle,
          likeCount: _post.likeCount + (_post.likedByMe ? -1 : 1),
          commentCount: _post.commentCount,
          likedByMe: !_post.likedByMe,
          author: _post.author,
          createdAt: _post.createdAt,
        );
      });
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _delete() async {
    await ref.read(textPostRepositoryProvider).delete(_post.id);
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final isOwner = _post.userId == ref.read(authControllerProvider).userId;
    return Scaffold(
      backgroundColor: _backgroundStyles[_post.backgroundStyle] ?? Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        actions: [if (isOwner) IconButton(icon: const Icon(Icons.delete_outline), onPressed: _delete)],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_post.text, style: const TextStyle(color: Colors.white, fontSize: 24), textAlign: TextAlign.center),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    icon: Icon(_post.likedByMe ? Icons.favorite : Icons.favorite_border, color: _post.likedByMe ? Colors.red : Colors.white),
                    onPressed: _toggleLike,
                  ),
                  Text('${_post.likeCount}', style: const TextStyle(color: Colors.white)),
                  const SizedBox(width: 24),
                  const Icon(Icons.mode_comment_outlined, color: Colors.white),
                  const SizedBox(width: 4),
                  Text('${_post.commentCount}', style: const TextStyle(color: Colors.white)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
