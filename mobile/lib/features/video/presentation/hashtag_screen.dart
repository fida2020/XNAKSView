import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import 'feed_controller.dart';
import 'video_page_view.dart';
import 'video_providers.dart';

/// Hashtag page (Step 6, brief §9) — post count + a grid of every public,
/// ready video carrying the tag, tapping into the same full-screen player
/// used everywhere else in the app.
class HashtagScreen extends ConsumerStatefulWidget {
  const HashtagScreen({super.key, required this.tag});

  final String tag;

  @override
  ConsumerState<HashtagScreen> createState() => _HashtagScreenState();
}

class _HashtagScreenState extends ConsumerState<HashtagScreen> {
  int? _postCount;
  bool _isLoadingMeta = true;

  @override
  void initState() {
    super.initState();
    _loadMeta();
  }

  Future<void> _loadMeta() async {
    try {
      final result = await ref.read(videoRepositoryProvider).fetchHashtag(widget.tag);
      if (mounted) setState(() => _postCount = result.postCount);
    } on AppException {
      // Best-effort — the grid itself still loads independently.
    } finally {
      if (mounted) setState(() => _isLoadingMeta = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(hashtagVideosControllerProvider(widget.tag));

    return Scaffold(
      appBar: AppBar(title: Text('#${widget.tag}')),
      body: RefreshIndicator(
        onRefresh: () => ref.read(hashtagVideosControllerProvider(widget.tag).notifier).loadInitial(),
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: _isLoadingMeta
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text('${_postCount ?? 0} posts', style: Theme.of(context).textTheme.bodyMedium),
              ),
            ),
            _buildGrid(state),
          ],
        ),
      ),
    );
  }

  Widget _buildGrid(FeedState state) {
    if (state.videos.isEmpty && state.status == FeedLoadStatus.loading) {
      return const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())));
    }
    if (state.videos.isEmpty) {
      return const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No videos yet'))));
    }

    return SliverPadding(
      padding: const EdgeInsets.all(2),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 2,
          mainAxisSpacing: 2,
          childAspectRatio: 9 / 16,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final video = state.videos[index];
            return GestureDetector(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => Scaffold(
                    backgroundColor: Colors.black,
                    body: VideoPageView(
                      controllerProvider: hashtagVideosControllerProvider(widget.tag),
                      initialIndex: index,
                    ),
                  ),
                ),
              ),
              child: video.thumbnailUrl == null
                  ? Container(color: Colors.black12, child: const Icon(Icons.hourglass_empty))
                  : _AuthenticatedThumbnail(path: video.thumbnailUrl!),
            );
          },
          childCount: state.videos.length,
        ),
      ),
    );
  }
}

class _AuthenticatedThumbnail extends ConsumerWidget {
  const _AuthenticatedThumbnail({required this.path});

  final String path;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<String?>(
      future: ref.read(secureStorageProvider).read(StorageKeys.accessToken),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox.shrink();
        final uri = AppConfig.resolveMediaUrl(path);
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
