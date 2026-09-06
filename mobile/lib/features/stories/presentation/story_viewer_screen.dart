import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/story_model.dart';
import 'stories_providers.dart';

const _reportReasons = ['SPAM', 'NUDITY_OR_SEXUAL_CONTENT', 'VIOLENCE', 'HARASSMENT_OR_BULLYING', 'HATE_SPEECH', 'MISINFORMATION', 'OTHER'];
const _photoDuration = Duration(seconds: 5);

/// Story viewer (Step 6, brief D) — tap-to-advance through one author's
/// stories with a per-story progress bar, matching current TikTok/Stories
/// UX conventions generally (original XNAKView visuals, no copied assets).
class StoryViewerScreen extends ConsumerStatefulWidget {
  const StoryViewerScreen({super.key, required this.group, this.initialIndex = 0});

  final StoryGroup group;
  final int initialIndex;

  @override
  ConsumerState<StoryViewerScreen> createState() => _StoryViewerScreenState();
}

class _StoryViewerScreenState extends ConsumerState<StoryViewerScreen> with SingleTickerProviderStateMixin {
  late int _index = widget.initialIndex;
  late AnimationController _progressController;
  VideoPlayerController? _videoController;
  bool get _isOwner => widget.group.author?.id == ref.read(authControllerProvider).userId;

  StoryModel get _current => widget.group.stories[_index];

  @override
  void initState() {
    super.initState();
    _progressController = AnimationController(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _advance();
      });
    _loadCurrent();
  }

  Future<void> _loadCurrent() async {
    _progressController.stop();
    _progressController.reset();
    _videoController?.dispose();
    _videoController = null;

    try {
      await ref.read(storiesRepositoryProvider).viewStory(_current.id);
    } on AppException {
      // Best-effort — viewing still proceeds locally even if the view-count call fails.
    }
    if (!mounted) return;

    if (_current.mediaType == StoryMediaType.video) {
      final token = await ref.read(secureStorageProvider).read(StorageKeys.accessToken);
      final controller = VideoPlayerController.networkUrl(
        AppConfig.resolveMediaUrl(_current.mediaUrl),
        httpHeaders: {if (token != null) 'Authorization': 'Bearer $token'},
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _videoController = controller);
      _progressController.duration = controller.value.duration;
      controller.play();
      _progressController.forward();
    } else {
      _progressController.duration = _photoDuration;
      _progressController.forward();
    }
  }

  void _advance() {
    if (_index < widget.group.stories.length - 1) {
      setState(() => _index += 1);
      _loadCurrent();
    } else {
      Navigator.of(context).pop();
    }
  }

  void _rewind() {
    if (_index > 0) {
      setState(() => _index -= 1);
      _loadCurrent();
    }
  }

  Future<void> _reply(String text) async {
    if (text.trim().isEmpty) return;
    try {
      await ref.read(storiesRepositoryProvider).reply(_current.id, text.trim());
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reply sent')));
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _report() async {
    _progressController.stop();
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [for (final r in _reportReasons) ListTile(title: Text(r.replaceAll('_', ' ')), onTap: () => Navigator.of(context).pop(r))],
        ),
      ),
    );
    if (reason != null) {
      try {
        await ref.read(storiesRepositoryProvider).report(_current.id, reason: reason);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reported. Thank you.')));
      } on AppException catch (error) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
    _progressController.forward();
  }

  Future<void> _delete() async {
    await ref.read(storiesRepositoryProvider).delete(_current.id);
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  Future<void> _showViewers() async {
    _progressController.stop();
    final viewers = await ref.read(storiesRepositoryProvider).fetchViewers(_current.id);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(padding: const EdgeInsets.all(16), child: Text('${viewers.length} views')),
            for (final viewer in viewers) ListTile(title: Text(viewer.displayLabel)),
          ],
        ),
      ),
    );
    _progressController.forward();
  }

  @override
  void dispose() {
    _progressController.dispose();
    _videoController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            GestureDetector(
              onTapUp: (details) {
                final width = MediaQuery.of(context).size.width;
                if (details.globalPosition.dx < width / 3) {
                  _rewind();
                } else {
                  _advance();
                }
              },
              child: Center(
                child: _current.mediaType == StoryMediaType.video
                    ? (_videoController != null && _videoController!.value.isInitialized
                        ? AspectRatio(aspectRatio: _videoController!.value.aspectRatio, child: VideoPlayer(_videoController!))
                        : const CircularProgressIndicator())
                    : _AuthenticatedStoryPhoto(url: _current.mediaUrl),
              ),
            ),
            Positioned(
              top: 8,
              left: 8,
              right: 8,
              child: Row(
                children: [
                  for (var i = 0; i < widget.group.stories.length; i++)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 2),
                        child: AnimatedBuilder(
                          animation: _progressController,
                          builder: (context, _) => LinearProgressIndicator(
                            value: i < _index ? 1 : (i == _index ? _progressController.value : 0),
                            backgroundColor: Colors.white24,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Positioned(
              top: 20,
              left: 8,
              right: 8,
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 16,
                    backgroundImage: widget.group.author?.avatarUrl != null ? NetworkImage(widget.group.author!.avatarUrl!) : null,
                    child: widget.group.author?.avatarUrl == null ? const Icon(Icons.person, size: 16) : null,
                  ),
                  const SizedBox(width: 8),
                  Text(widget.group.author?.displayLabel ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  const Spacer(),
                  if (_isOwner)
                    IconButton(icon: const Icon(Icons.remove_red_eye_outlined, color: Colors.white), onPressed: _showViewers),
                  if (_isOwner)
                    IconButton(icon: const Icon(Icons.delete_outline, color: Colors.white), onPressed: _delete)
                  else
                    IconButton(icon: const Icon(Icons.flag_outlined, color: Colors.white), onPressed: _report),
                  IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            if (!_isOwner)
              Positioned(
                left: 16,
                right: 16,
                bottom: 16,
                child: _ReplyBar(onSend: _reply),
              ),
          ],
        ),
      ),
    );
  }
}

class _ReplyBar extends StatefulWidget {
  const _ReplyBar({required this.onSend});

  final ValueChanged<String> onSend;

  @override
  State<_ReplyBar> createState() => _ReplyBarState();
}

class _ReplyBarState extends State<_ReplyBar> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _controller,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Reply…',
              hintStyle: const TextStyle(color: Colors.white70),
              filled: true,
              fillColor: Colors.white24,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16),
            ),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.send, color: Colors.white),
          onPressed: () {
            widget.onSend(_controller.text);
            _controller.clear();
          },
        ),
      ],
    );
  }
}

class _AuthenticatedStoryPhoto extends ConsumerWidget {
  const _AuthenticatedStoryPhoto({required this.url});

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
          fit: BoxFit.contain,
          errorBuilder: (context, error, stackTrace) => const Icon(Icons.broken_image, color: Colors.white54),
        );
      },
    );
  }
}
