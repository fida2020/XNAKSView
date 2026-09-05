import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'feed_controller.dart';
import 'video_feed_item.dart';

/// Vertical, swipeable full-screen video pager shared by the main feed and a
/// single creator's video list — both are just a [FeedController] with a
/// different fetch source (see feed_controller.dart).
class VideoPageView extends ConsumerStatefulWidget {
  const VideoPageView({
    super.key,
    required this.controllerProvider,
    this.initialIndex = 0,
    this.emptyMessage = 'No videos yet',
  });

  final StateNotifierProvider<FeedController, FeedState> controllerProvider;
  final int initialIndex;
  final String emptyMessage;

  @override
  ConsumerState<VideoPageView> createState() => _VideoPageViewState();
}

class _VideoPageViewState extends ConsumerState<VideoPageView> {
  late final PageController _pageController = PageController(initialPage: widget.initialIndex);
  late int _activeIndex = widget.initialIndex;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    setState(() => _activeIndex = index);
    final state = ref.read(widget.controllerProvider);
    if (index >= state.videos.length - 2) {
      ref.read(widget.controllerProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(widget.controllerProvider);

    if (state.status == FeedLoadStatus.loading && state.videos.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: Colors.white));
    }

    if (state.status == FeedLoadStatus.error && state.videos.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.errorMessage ?? 'Something went wrong', style: const TextStyle(color: Colors.white)),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => ref.read(widget.controllerProvider.notifier).loadInitial(),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (state.videos.isEmpty) {
      return Center(child: Text(widget.emptyMessage, style: const TextStyle(color: Colors.white)));
    }

    return PageView.builder(
      controller: _pageController,
      scrollDirection: Axis.vertical,
      itemCount: state.videos.length,
      onPageChanged: _onPageChanged,
      itemBuilder: (context, index) {
        final video = state.videos[index];
        return VideoFeedItem(
          key: ValueKey(video.id),
          video: video,
          isActive: index == _activeIndex,
          controllerProvider: widget.controllerProvider,
        );
      },
    );
  }
}
