import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/story_model.dart';
import 'create_story_screen.dart';
import 'stories_providers.dart';
import 'story_viewer_screen.dart';

/// Horizontal Stories carousel (Step 2) for the top of the Friends feed —
/// reuses the same real `/stories/feed` data, grouping, viewer and creation
/// flow as [StoriesTrayScreen]; this is just a compact horizontal
/// presentation of the identical real data, not a second story system.
class StoriesCarousel extends ConsumerStatefulWidget {
  const StoriesCarousel({super.key});

  @override
  ConsumerState<StoriesCarousel> createState() => _StoriesCarouselState();
}

class _StoriesCarouselState extends ConsumerState<StoriesCarousel> {
  List<StoryGroup> _otherGroups = [];
  StoryGroup? _ownGroup;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final stories = await ref.read(storiesRepositoryProvider).fetchFeed();
      final myUserId = ref.read(authControllerProvider).userId;
      final byAuthor = <String, List<StoryModel>>{};
      for (final story in stories) {
        (byAuthor[story.userId] ??= []).add(story);
      }
      StoryGroup? ownGroup;
      final otherGroups = <StoryGroup>[];
      for (final entry in byAuthor.entries) {
        final group = StoryGroup(
          author: entry.value.first.author,
          stories: entry.value..sort((a, b) => a.createdAt.compareTo(b.createdAt)),
        );
        if (entry.key == myUserId) {
          ownGroup = group;
        } else {
          otherGroups.add(group);
        }
      }
      if (mounted) {
        setState(() {
          _ownGroup = ownGroup;
          _otherGroups = otherGroups;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _errorMessage = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _openViewer(StoryGroup group) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (context) => StoryViewerScreen(group: group)));
    _load();
  }

  Future<void> _createStory() async {
    final posted = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (context) => const CreateStoryScreen()));
    if (posted == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const SizedBox(height: 100, child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
    }
    if (_errorMessage != null && _ownGroup == null && _otherGroups.isEmpty) {
      return SizedBox(
        height: 100,
        child: Center(
          child: TextButton(onPressed: _load, child: Text('Couldn\'t load stories — tap to retry', style: TextStyle(color: Colors.white70))),
        ),
      );
    }

    return SizedBox(
      height: 100,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        children: [
          _StoryTile(
            label: _ownGroup != null ? 'Your story' : 'Add story',
            avatarUrl: _ownGroup?.author?.avatarUrl,
            hasStory: _ownGroup != null,
            showAddBadge: true,
            onTap: () => _ownGroup != null ? _openViewer(_ownGroup!) : _createStory(),
            onAddBadgeTap: _createStory,
          ),
          for (final group in _otherGroups)
            _StoryTile(
              label: group.author?.displayLabel ?? '',
              avatarUrl: group.author?.avatarUrl,
              hasStory: true,
              showAddBadge: false,
              onTap: () => _openViewer(group),
            ),
        ],
      ),
    );
  }
}

class _StoryTile extends StatelessWidget {
  const _StoryTile({
    required this.label,
    required this.avatarUrl,
    required this.hasStory,
    required this.showAddBadge,
    required this.onTap,
    this.onAddBadgeTap,
  });

  final String label;
  final String? avatarUrl;
  final bool hasStory;
  final bool showAddBadge;
  final VoidCallback onTap;
  final VoidCallback? onAddBadgeTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 72,
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: hasStory
                        ? const LinearGradient(colors: [Color(0xFFFE2C55), Color(0xFF25F4EE)])
                        : null,
                    border: hasStory ? null : Border.all(color: Colors.white24, width: 1.5),
                  ),
                  child: CircleAvatar(
                    radius: 28,
                    backgroundColor: Colors.grey.shade800,
                    backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl!) : null,
                    child: avatarUrl == null ? const Icon(Icons.person, color: Colors.white70) : null,
                  ),
                ),
                if (showAddBadge)
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: GestureDetector(
                      onTap: onAddBadgeTap,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: const BoxDecoration(
                          color: Color(0xFFFE2C55),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.add, color: Colors.white, size: 14),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
