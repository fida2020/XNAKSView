import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import '../../photopost/presentation/create_photo_post_screen.dart';
import '../../stories/presentation/create_story_screen.dart';
import '../../stories/presentation/stories_tray_screen.dart';
import '../../textpost/presentation/create_text_post_screen.dart';
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
            left: 56,
            child: IconButton(
              icon: const Icon(Icons.search, color: Colors.white),
              tooltip: 'Search',
              onPressed: () => context.pushSearch(),
            ),
          ),
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 100,
            child: IconButton(
              icon: const Icon(Icons.auto_stories_outlined, color: Colors.white),
              tooltip: 'Stories',
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (context) => const StoriesTrayScreen())),
            ),
          ),
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            right: 100,
            child: IconButton(
              icon: const Icon(Icons.notifications_outlined, color: Colors.white),
              tooltip: 'Activity',
              onPressed: () => context.pushActivity(),
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
        onPressed: () => _showCreateMenu(context),
        tooltip: 'Create',
        child: const Icon(Icons.add),
      ),
    );
  }

  void _showCreateMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.videocam_outlined),
              title: const Text('Video'),
              onTap: () {
                Navigator.of(context).pop();
                context.pushUploadVideo();
              },
            ),
            ListTile(
              leading: const Icon(Icons.auto_stories_outlined),
              title: const Text('Story'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(MaterialPageRoute(builder: (context) => const CreateStoryScreen()));
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Photo post'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(MaterialPageRoute(builder: (context) => const CreatePhotoPostScreen()));
              },
            ),
            ListTile(
              leading: const Icon(Icons.text_fields),
              title: const Text('Text post'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(MaterialPageRoute(builder: (context) => const CreateTextPostScreen()));
              },
            ),
          ],
        ),
      ),
    );
  }
}
