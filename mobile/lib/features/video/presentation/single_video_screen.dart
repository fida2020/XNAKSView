import 'package:flutter/material.dart';

import 'feed_controller.dart';
import 'video_page_view.dart';

/// Opened from a shared video deep link (`xnakview://video/:id`) — the real
/// destination Share's "Copy Link"/native share point at (see
/// `share_sheet.dart`). Reuses the exact same full-screen player/action-rail
/// widget as the main feed via `singleVideoControllerProvider`.
class SingleVideoScreen extends StatelessWidget {
  const SingleVideoScreen({super.key, required this.videoId});

  final String videoId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          Positioned.fill(
            child: VideoPageView(
              controllerProvider: singleVideoControllerProvider(videoId),
              emptyMessage: 'This video is no longer available.',
            ),
          ),
          Positioned(
            top: 8,
            left: 8,
            child: SafeArea(
              child: IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
