import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/text_post_model.dart';
import 'text_post_detail_screen.dart';
import 'text_post_providers.dart';

class TextPostsListScreen extends ConsumerStatefulWidget {
  const TextPostsListScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<TextPostsListScreen> createState() => _TextPostsListScreenState();
}

class _TextPostsListScreenState extends ConsumerState<TextPostsListScreen> {
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
    return Scaffold(
      appBar: AppBar(title: const Text('Text posts')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _posts.isEmpty
              ? const Center(child: Text('No text posts yet'))
              : ListView(
                  children: [
                    for (final post in _posts)
                      ListTile(
                        title: Text(post.text, maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text('${post.likeCount} likes · ${post.commentCount} comments'),
                        onTap: () async {
                          await Navigator.of(context).push(MaterialPageRoute(builder: (context) => TextPostDetailScreen(post: post)));
                          _load();
                        },
                      ),
                  ],
                ),
    );
  }
}
