import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/text_post_model.dart';
import 'text_post_detail_screen.dart';
import 'text_post_providers.dart';

class TextPostsListScreen extends StatelessWidget {
  const TextPostsListScreen({super.key, required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(appBar: AppBar(title: const Text('Text posts')), body: TextPostsGrid(userId: userId));
  }
}

/// The grid body only, no `Scaffold`/`AppBar` — embeddable as a profile
/// content tab or pushed standalone via [TextPostsListScreen] above.
class TextPostsGrid extends ConsumerStatefulWidget {
  const TextPostsGrid({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<TextPostsGrid> createState() => _TextPostsGridState();
}

class _TextPostsGridState extends ConsumerState<TextPostsGrid> {
  List<TextPostModel> _posts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final posts = await ref.read(textPostRepositoryProvider).fetchForUser(widget.userId);
      if (mounted) setState(() => _posts = posts);
    } on AppException {
      // Leave the list empty on failure.
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _isLoading
        ? const Center(child: CircularProgressIndicator())
        : _posts.isEmpty
            ? const Center(child: Text('No text posts yet'))
            : GridView.builder(
                padding: const EdgeInsets.all(8),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, crossAxisSpacing: 8, mainAxisSpacing: 8, childAspectRatio: 1),
                itemCount: _posts.length,
                itemBuilder: (context, index) {
                  final post = _posts[index];
                  return GestureDetector(
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (context) => TextPostDetailScreen(post: post)));
                      _load();
                    },
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: Text(post.text, maxLines: 5, overflow: TextOverflow.ellipsis)),
                          const SizedBox(height: 6),
                          Text('${post.likeCount} likes · ${post.commentCount} comments', style: const TextStyle(fontSize: 11)),
                        ],
                      ),
                    ),
                  );
                },
              );
  }
}
