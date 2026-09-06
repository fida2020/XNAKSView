import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/story_model.dart';
import 'create_story_screen.dart';
import 'stories_providers.dart';
import 'story_viewer_screen.dart';

/// The Story tray/profile entry (Step 6, brief D) — every author with at
/// least one currently-active (non-expired) story, grouped from the flat
/// `/stories/feed` list.
class StoriesTrayScreen extends ConsumerStatefulWidget {
  const StoriesTrayScreen({super.key});

  @override
  ConsumerState<StoriesTrayScreen> createState() => _StoriesTrayScreenState();
}

class _StoriesTrayScreenState extends ConsumerState<StoriesTrayScreen> {
  List<StoryGroup> _groups = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final stories = await ref.read(storiesRepositoryProvider).fetchFeed();
      final byAuthor = <String, List<StoryModel>>{};
      for (final story in stories) {
        (byAuthor[story.userId] ??= []).add(story);
      }
      final groups = byAuthor.values
          .map((stories) => StoryGroup(author: stories.first.author, stories: stories..sort((a, b) => a.createdAt.compareTo(b.createdAt))))
          .toList();
      if (mounted) setState(() => _groups = groups);
    } on AppException {
      // Leave the tray empty on failure.
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
    return Scaffold(
      appBar: AppBar(title: const Text('Stories')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: GridView.builder(
                padding: const EdgeInsets.all(16),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 4, mainAxisSpacing: 16),
                itemCount: _groups.length,
                itemBuilder: (context, index) {
                  final group = _groups[index];
                  return GestureDetector(
                    onTap: () => _openViewer(group),
                    child: Column(
                      children: [
                        CircleAvatar(
                          radius: 30,
                          backgroundColor: Theme.of(context).colorScheme.primary,
                          child: CircleAvatar(
                            radius: 27,
                            backgroundImage: group.author?.avatarUrl != null ? NetworkImage(group.author!.avatarUrl!) : null,
                            child: group.author?.avatarUrl == null ? const Icon(Icons.person) : null,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(group.author?.displayLabel ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                      ],
                    ),
                  );
                },
              ),
            ),
      floatingActionButton: FloatingActionButton(onPressed: _createStory, child: const Icon(Icons.add)),
    );
  }
}
