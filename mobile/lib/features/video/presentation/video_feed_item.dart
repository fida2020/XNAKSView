import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import '../../../core/config/app_config.dart';
import '../../../core/router/app_router.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/video_model.dart';
import 'add_yours_response_screen.dart';
import 'add_yours_responses_screen.dart';
import 'comment_sheet.dart';
import 'feed_controller.dart';
import 'video_providers.dart';

/// One full-screen page in the vertical feed: video playback plus the
/// like/comment/share/follow overlay. Playback is driven by [isActive] —
/// the parent `PageView` decides which single item should be playing.
class VideoFeedItem extends ConsumerStatefulWidget {
  const VideoFeedItem({
    super.key,
    required this.video,
    required this.isActive,
    required this.controllerProvider,
  });

  final VideoModel video;
  final bool isActive;

  /// Which [FeedController] instance owns this video (the main feed, or a
  /// specific creator's video list) — engagement actions are dispatched
  /// through it so optimistic updates land in the right list.
  final StateNotifierProvider<FeedController, FeedState> controllerProvider;

  @override
  ConsumerState<VideoFeedItem> createState() => _VideoFeedItemState();
}

class _VideoFeedItemState extends ConsumerState<VideoFeedItem> {
  VideoPlayerController? _controller;
  bool _hasRecordedView = false;
  bool _initializing = false;

  @override
  void initState() {
    super.initState();
    if (widget.isActive) _initializePlayback();
  }

  @override
  void didUpdateWidget(covariant VideoFeedItem oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isActive && !oldWidget.isActive) {
      _initializePlayback();
    } else if (!widget.isActive && oldWidget.isActive) {
      _controller?.pause();
    }
  }

  Future<void> _initializePlayback() async {
    final playbackUrl = widget.video.playbackUrl;
    if (playbackUrl == null || _controller != null || _initializing) return;
    _initializing = true;

    final secureStorage = ref.read(secureStorageProvider);
    final token = await secureStorage.read(StorageKeys.accessToken);
    final uri = AppConfig.resolveMediaUrl(playbackUrl);

    final controller = VideoPlayerController.networkUrl(
      uri,
      httpHeaders: {if (token != null) 'Authorization': 'Bearer $token'},
    );

    try {
      await controller.initialize();
      controller.setLooping(true);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _controller = controller);
      if (widget.isActive) {
        await controller.play();
        _recordViewOnce();
      }
    } catch (_) {
      await controller.dispose();
    } finally {
      _initializing = false;
    }
  }

  void _recordViewOnce() {
    if (_hasRecordedView) return;
    _hasRecordedView = true;
    ref.read(videoRepositoryProvider).recordView(widget.video.id).catchError((_) {});
  }

  void _togglePlayPause() {
    final controller = _controller;
    if (controller == null) return;
    if (controller.value.isPlaying) {
      controller.pause();
    } else {
      controller.play();
      _recordViewOnce();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final video = ref.watch(widget.controllerProvider.select(
      (state) => state.videos.firstWhere((v) => v.id == widget.video.id, orElse: () => widget.video),
    ));

    return Container(
      color: Colors.black,
      child: Stack(
        fit: StackFit.expand,
        children: [
          GestureDetector(
            onTap: _togglePlayPause,
            child: _buildVideoSurface(video),
          ),
          Positioned(
            left: 12,
            right: 88,
            bottom: 24,
            child: _VideoInfoOverlay(video: video),
          ),
          Positioned(
            right: 8,
            bottom: 24,
            child: _VideoActionRail(video: video, controllerProvider: widget.controllerProvider),
          ),
        ],
      ),
    );
  }

  Widget _buildVideoSurface(VideoModel video) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return Stack(
        fit: StackFit.expand,
        children: [
          if (video.thumbnailUrl != null) _buildThumbnail(video.thumbnailUrl!),
          const Center(child: CircularProgressIndicator(color: Colors.white)),
        ],
      );
    }
    return FittedBox(
      fit: BoxFit.cover,
      child: SizedBox(
        width: controller.value.size.width,
        height: controller.value.size.height,
        child: VideoPlayer(controller),
      ),
    );
  }

  Widget _buildThumbnail(String thumbnailUrl) {
    return FutureBuilder<String?>(
      future: ref.read(secureStorageProvider).read(StorageKeys.accessToken),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox.shrink();
        final uri = AppConfig.resolveMediaUrl(thumbnailUrl);
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

class _VideoInfoOverlay extends StatelessWidget {
  const _VideoInfoOverlay({required this.video});

  final VideoModel video;

  @override
  Widget build(BuildContext context) {
    final author = video.author;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (author != null)
          Text(
            author.displayLabel,
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
          ),
        if (video.caption != null && video.caption!.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(video.caption!, style: const TextStyle(color: Colors.white), maxLines: 3, overflow: TextOverflow.ellipsis),
        ],
      ],
    );
  }
}

class _VideoActionRail extends ConsumerWidget {
  const _VideoActionRail({required this.video, required this.controllerProvider});

  final VideoModel video;
  final StateNotifierProvider<FeedController, FeedState> controllerProvider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(controllerProvider.notifier);
    final liked = video.likedByMe ?? false;
    final following = video.isFollowedByMe ?? false;
    final favorited = video.favoritedByMe;
    final reposted = video.repostedByMe;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (video.author != null && !following)
          _RailButton(
            icon: Icons.person_add_alt_1,
            onTap: () => controller.toggleFollow(video),
          ),
        const SizedBox(height: 20),
        _RailButton(
          icon: liked ? Icons.favorite : Icons.favorite_border,
          color: liked ? Colors.redAccent : Colors.white,
          label: '${video.likeCount}',
          onTap: () => controller.toggleLike(video),
        ),
        const SizedBox(height: 20),
        _RailButton(
          icon: Icons.mode_comment_outlined,
          label: '${video.commentCount}',
          onTap: () => showCommentSheet(context, ref, video, controllerProvider),
        ),
        const SizedBox(height: 20),
        _RailButton(
          icon: favorited ? Icons.bookmark : Icons.bookmark_border,
          color: favorited ? Colors.amberAccent : Colors.white,
          onTap: () => controller.toggleFavorite(video),
        ),
        const SizedBox(height: 20),
        _RailButton(
          icon: Icons.repeat,
          color: reposted ? Colors.greenAccent : Colors.white,
          onTap: () => controller.toggleRepost(video),
        ),
        const SizedBox(height: 20),
        _RailButton(
          icon: Icons.reply,
          label: '${video.shareCount}',
          onTap: () async {
            final repository = ref.read(videoRepositoryProvider);
            try {
              final shareCount = await repository.shareVideo(video.id);
              controller.applyShareCount(video.id, shareCount);
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Shared')));
              }
            } catch (_) {
              // Best-effort — sharing failing silently is preferable to
              // blocking the UI over a non-critical action.
            }
          },
        ),
        if (video.allowDuet || video.allowStitch || video.addYoursPrompt != null) ...[
          const SizedBox(height: 20),
          _RailButton(
            icon: Icons.more_horiz,
            onTap: () => _showReuseMenu(context, ref, video),
          ),
        ],
      ],
    );
  }

  void _showReuseMenu(BuildContext context, WidgetRef ref, VideoModel video) {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (video.allowDuet)
              ListTile(
                leading: const Icon(Icons.people_outline),
                title: const Text('Duet'),
                onTap: () {
                  Navigator.of(context).pop();
                  context.pushDuetCreate(video.id);
                },
              ),
            if (video.allowStitch)
              ListTile(
                leading: const Icon(Icons.content_cut),
                title: const Text('Stitch'),
                onTap: () {
                  Navigator.of(context).pop();
                  context.pushStitchCreate(video.id);
                },
              ),
            if (video.addYoursPrompt != null) ...[
              ListTile(
                leading: const Icon(Icons.auto_awesome),
                title: const Text('Add Yours'),
                subtitle: Text(video.addYoursPrompt!, maxLines: 1, overflow: TextOverflow.ellipsis),
                onTap: () {
                  Navigator.of(context).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (context) => AddYoursResponseScreen(promptVideoId: video.id, prompt: video.addYoursPrompt!)),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.grid_view_outlined),
                title: const Text('View responses'),
                onTap: () {
                  Navigator.of(context).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (context) => AddYoursResponsesScreen(promptVideoId: video.id)),
                  );
                },
              ),
            ],
            ListTile(
              leading: const Icon(Icons.music_note_outlined),
              title: const Text('Use this sound'),
              onTap: () async {
                Navigator.of(context).pop();
                try {
                  final soundId = await ref.read(videoRepositoryProvider).useSound(video.id);
                  if (context.mounted) context.pushUploadVideo(soundId: soundId);
                } catch (_) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not use this sound right now')));
                  }
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _RailButton extends StatelessWidget {
  const _RailButton({required this.icon, required this.onTap, this.label, this.color = Colors.white});

  final IconData icon;
  final VoidCallback onTap;
  final String? label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Icon(icon, color: color, size: 32, shadows: const [Shadow(blurRadius: 6, color: Colors.black54)]),
          if (label != null) ...[
            const SizedBox(height: 2),
            Text(label!, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
          ],
        ],
      ),
    );
  }
}
