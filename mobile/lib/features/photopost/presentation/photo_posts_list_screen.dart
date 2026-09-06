import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/photo_post_model.dart';
import 'photo_post_providers.dart';
import 'photo_post_viewer_screen.dart';

class PhotoPostsListScreen extends ConsumerStatefulWidget {
  const PhotoPostsListScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<PhotoPostsListScreen> createState() => _PhotoPostsListScreenState();
}

class _PhotoPostsListScreenState extends ConsumerState<PhotoPostsListScreen> {
  List<PhotoPostModel> _posts = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final posts = await ref.read(photoPostRepositoryProvider).fetchForUser(widget.userId);
      if (mounted) setState(() => _posts = posts);
    } on AppException {
      // Leave the grid empty on failure.
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Photo posts')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _posts.isEmpty
              ? const Center(child: Text('No photo posts yet'))
              : GridView.builder(
                  padding: const EdgeInsets.all(2),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 2, mainAxisSpacing: 2, childAspectRatio: 9 / 16),
                  itemCount: _posts.length,
                  itemBuilder: (context, index) {
                    final post = _posts[index];
                    return GestureDetector(
                      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (context) => PhotoPostViewerScreen(photoPostId: post.id))),
                      child: post.photos.isEmpty
                          ? Container(color: Colors.black12, child: const Icon(Icons.image_outlined))
                          : _AuthenticatedThumbnail(url: post.photos.first.url),
                    );
                  },
                ),
    );
  }
}

class _AuthenticatedThumbnail extends ConsumerWidget {
  const _AuthenticatedThumbnail({required this.url});

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
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
        );
      },
    );
  }
}
