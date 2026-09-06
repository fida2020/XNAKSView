import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import 'feed_controller.dart';
import 'video_page_view.dart';

class FeedScreen extends ConsumerWidget {
  const FeedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          RefreshIndicator(
            onRefresh: () => ref.read(feedControllerProvider.notifier).loadInitial(),
            child: VideoPageView(
              controllerProvider: feedControllerProvider,
              emptyMessage: 'No videos yet — be the first to upload!',
            ),
          ),
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 12,
            child: IconButton(
              icon: const Icon(Icons.live_tv, color: Colors.white),
              tooltip: 'LIVE',
              onPressed: () => context.pushLiveDiscovery(),
            ),
          ),
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            right: 56,
            child: IconButton(
              icon: const Icon(Icons.chat_bubble_outline, color: Colors.white),
              tooltip: 'Messages',
              onPressed: () => context.pushInbox(),
            ),
          ),
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            right: 12,
            child: IconButton(
              icon: const Icon(Icons.person_outline, color: Colors.white),
              onPressed: () => context.pushCreatorProfile(),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.pushUploadVideo(),
        tooltip: 'Upload video',
        child: const Icon(Icons.add),
      ),
    );
  }
}
