import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/epidemic_track_model.dart';
import 'video_providers.dart';

/// Returned from [SoundPickerScreen] when the user selects a sound — either
/// a real licensed Epidemic Sound track or a real reused XNAKView `Sound`.
class SelectedSound {
  const SelectedSound({required this.id, required this.title, this.artist, this.isEpidemic = false});
  final String id;
  final String title;
  final String? artist;
  final bool isEpidemic;
}

/// Add Sound (Create rebuild) — a real, tabbed picker: Browse/Search/
/// Favorites/Recent are a real licensed catalog (Epidemic Sound Partner
/// Content API, see backend's lib/epidemicSound.ts); "XNAKView Sounds" is
/// the separate, pre-existing real "reuse another video's audio" feature.
/// Neither tab is a static/fabricated list — both are live backend data.
class SoundPickerScreen extends ConsumerStatefulWidget {
  const SoundPickerScreen({super.key});

  @override
  ConsumerState<SoundPickerScreen> createState() => _SoundPickerScreenState();
}

class _SoundPickerScreenState extends ConsumerState<SoundPickerScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 4, vsync: this);

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add sound'),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: const [Tab(text: 'Browse'), Tab(text: 'Favorites'), Tab(text: 'Recent'), Tab(text: 'XNAKView Sounds')],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          _EpidemicBrowseTab(),
          _EpidemicListTab(kind: _EpidemicListKind.favorites),
          _EpidemicListTab(kind: _EpidemicListKind.recent),
          _XnakSoundsTab(),
        ],
      ),
    );
  }
}

class _TrackPreviewPlayer {
  _TrackPreviewPlayer._();
  static final instance = _TrackPreviewPlayer._();
  final AudioPlayer _player = AudioPlayer();
  String? _playingTrackId;

  String? get playingTrackId => _playingTrackId;

  Future<void> toggle(String trackId, Future<String> Function() fetchUrl, VoidCallback onChanged) async {
    if (_playingTrackId == trackId) {
      await _player.stop();
      _playingTrackId = null;
      onChanged();
      return;
    }
    _playingTrackId = trackId;
    onChanged();
    try {
      final url = await fetchUrl();
      await _player.setUrl(url);
      await _player.play();
      _player.playerStateStream.firstWhere((s) => s.processingState == ProcessingState.completed).then((_) {
        if (_playingTrackId == trackId) {
          _playingTrackId = null;
          onChanged();
        }
      });
    } on AppException {
      _playingTrackId = null;
      onChanged();
    }
  }
}

class _EpidemicBrowseTab extends ConsumerStatefulWidget {
  const _EpidemicBrowseTab();

  @override
  ConsumerState<_EpidemicBrowseTab> createState() => _EpidemicBrowseTabState();
}

class _EpidemicBrowseTabState extends ConsumerState<_EpidemicBrowseTab> {
  final _searchController = TextEditingController();
  String? _query;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'Search real licensed tracks',
              prefixIcon: const Icon(Icons.search),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
              isDense: true,
            ),
            onSubmitted: (value) => setState(() => _query = value.trim().isEmpty ? null : value.trim()),
          ),
        ),
        Expanded(
          child: FutureBuilder<EpidemicTrackPage>(
            key: ValueKey(_query),
            future: _query == null
                ? ref.read(epidemicSoundRepositoryProvider).browse()
                : ref.read(epidemicSoundRepositoryProvider).search(_query!),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                final error = snapshot.error;
                return AppErrorWidget(
                  message: error is AppException ? error.message : 'Failed to load the music catalog',
                  onRetry: () => setState(() {}),
                );
              }
              final tracks = snapshot.data!.tracks;
              if (tracks.isEmpty) {
                return const Center(child: Text('No tracks found'));
              }
              return ListView.builder(
                itemCount: tracks.length,
                itemBuilder: (context, index) => _EpidemicTrackTile(track: tracks[index]),
              );
            },
          ),
        ),
      ],
    );
  }
}

enum _EpidemicListKind { favorites, recent }

class _EpidemicListTab extends ConsumerStatefulWidget {
  const _EpidemicListTab({required this.kind});
  final _EpidemicListKind kind;

  @override
  ConsumerState<_EpidemicListTab> createState() => _EpidemicListTabState();
}

class _EpidemicListTabState extends ConsumerState<_EpidemicListTab> {
  late Future<List<EpidemicTrackModel>> _future = _load();

  Future<List<EpidemicTrackModel>> _load() {
    final repo = ref.read(epidemicSoundRepositoryProvider);
    return widget.kind == _EpidemicListKind.favorites ? repo.fetchFavorites() : repo.fetchRecent();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<EpidemicTrackModel>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          final error = snapshot.error;
          return AppErrorWidget(
            message: error is AppException ? error.message : 'Failed to load',
            onRetry: () => setState(() => _future = _load()),
          );
        }
        final tracks = snapshot.data!;
        if (tracks.isEmpty) {
          return Center(
            child: Text(
              widget.kind == _EpidemicListKind.favorites
                  ? 'No favorited sounds yet — tap the heart on a track in Browse.'
                  : 'No recently-used sounds yet — sounds you post with will show up here.',
              textAlign: TextAlign.center,
            ),
          );
        }
        return ListView.builder(
          itemCount: tracks.length,
          itemBuilder: (context, index) => _EpidemicTrackTile(track: tracks[index]),
        );
      },
    );
  }
}

class _EpidemicTrackTile extends ConsumerStatefulWidget {
  const _EpidemicTrackTile({required this.track});
  final EpidemicTrackModel track;

  @override
  ConsumerState<_EpidemicTrackTile> createState() => _EpidemicTrackTileState();
}

class _EpidemicTrackTileState extends ConsumerState<_EpidemicTrackTile> {
  bool? _isFavorited;

  @override
  Widget build(BuildContext context) {
    final player = _TrackPreviewPlayer.instance;
    final isPlaying = player.playingTrackId == widget.track.id;
    return ListTile(
      leading: CircleAvatar(
        backgroundImage: widget.track.coverImageUrl != null ? NetworkImage(widget.track.coverImageUrl!) : null,
        child: widget.track.coverImageUrl == null ? const Icon(Icons.music_note) : null,
      ),
      title: Text(widget.track.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text('${widget.track.artist}${widget.track.durationLabel.isNotEmpty ? ' · ${widget.track.durationLabel}' : ''}'),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: Icon(isPlaying ? Icons.stop_circle_outlined : Icons.play_circle_outline),
            onPressed: () => player.toggle(
              widget.track.id,
              () => ref.read(epidemicSoundRepositoryProvider).fetchPreviewUrl(widget.track.id),
              () => setState(() {}),
            ),
          ),
          IconButton(
            icon: Icon(_isFavorited == true ? Icons.favorite : Icons.favorite_border, color: _isFavorited == true ? Colors.red : null),
            onPressed: () async {
              final repo = ref.read(epidemicSoundRepositoryProvider);
              try {
                if (_isFavorited == true) {
                  await repo.unfavorite(widget.track.id);
                } else {
                  await repo.favorite(widget.track);
                }
                setState(() => _isFavorited = !(_isFavorited ?? false));
              } on AppException catch (error) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
              }
            },
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(
              SelectedSound(id: widget.track.id, title: widget.track.title, artist: widget.track.artist, isEpidemic: true),
            ),
            child: const Text('Use'),
          ),
        ],
      ),
    );
  }
}

/// The pre-existing real "reuse another video's audio" feature — unchanged
/// behavior, just relocated into its own tab now that Add Sound also has a
/// real licensed catalog.
class _XnakSoundsTab extends ConsumerStatefulWidget {
  const _XnakSoundsTab();

  @override
  ConsumerState<_XnakSoundsTab> createState() => _XnakSoundsTabState();
}

class _XnakSoundsTabState extends ConsumerState<_XnakSoundsTab> {
  final _searchController = TextEditingController();
  String? _query;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'Search sounds',
              prefixIcon: const Icon(Icons.search),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
              isDense: true,
            ),
            onSubmitted: (value) => setState(() => _query = value.trim().isEmpty ? null : value.trim()),
          ),
        ),
        if (_query == null)
          const Padding(
            padding: EdgeInsets.only(left: 16, bottom: 8),
            child: Align(alignment: Alignment.centerLeft, child: Text('Most-used sounds on XNAKView', style: TextStyle(fontWeight: FontWeight.w600))),
          ),
        Expanded(
          child: FutureBuilder(
            key: ValueKey(_query),
            future: ref.read(soundRepositoryProvider).fetchSounds(query: _query),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                final error = snapshot.error;
                return AppErrorWidget(message: error is AppException ? error.message : 'Failed to load sounds', onRetry: () => setState(() {}));
              }
              final sounds = snapshot.data!;
              if (sounds.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      _query != null
                          ? 'No sounds match "$_query". Sounds can only be found by their exact saved title — most sounds on XNAKView have none yet.'
                          : 'No sounds have been reused yet. Post a video, then come back and try "Use this sound" from it.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                );
              }
              return ListView.builder(
                itemCount: sounds.length,
                itemBuilder: (context, index) {
                  final sound = sounds[index];
                  return ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.music_note)),
                    title: Text(sound.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text('${sound.usageCount} videos${sound.authorLabel != null ? ' · ${sound.authorLabel}' : ''}'),
                    trailing: FilledButton(
                      onPressed: () => Navigator.of(context).pop(SelectedSound(id: sound.id, title: sound.title)),
                      child: const Text('Use'),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
