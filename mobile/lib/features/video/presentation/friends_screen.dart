import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../stories/presentation/stories_carousel.dart';
import 'feed_controller.dart';
import 'video_page_view.dart';

/// The Friends tab (Step 2) — top: a real Stories carousel (own + every
/// followed/following-back author with an active story); below: a real
/// vertical video feed scoped server-side to mutual follows only (see
/// `friendsFeedControllerProvider` / `GET /feed?scope=friends`). No
/// fabricated friend-request layer — "friends" is a real mutual follow.
class FriendsScreen extends ConsumerWidget {
  const FriendsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        elevation: 0,
        title: const Text('Friends', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: SafeArea(
        child: Column(
          children: [
            const StoriesCarousel(),
            const Divider(color: Colors.white12, height: 1),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.read(friendsFeedControllerProvider.notifier).loadInitial(),
                child: VideoPageView(
                  key: const ValueKey('friends'),
                  controllerProvider: friendsFeedControllerProvider,
                  emptyMessage: 'No friends yet — follow someone who follows you back to see their videos here.',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
