import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../video/domain/video_model.dart';
import '../../video/presentation/video_providers.dart';
import '../data/playlists_repository.dart';
import 'playlists_providers.dart';

class PlaylistDetailScreen extends ConsumerStatefulWidget {
  const PlaylistDetailScreen({super.key, required this.playlistId});

  final String playlistId;

  @override
  ConsumerState<PlaylistDetailScreen> createState() => _PlaylistDetailScreenState();
}

class _PlaylistDetailScreenState extends ConsumerState<PlaylistDetailScreen> {
  PlaylistDetail? _playlist;
  bool _isLoading = true;
  String? _error;

  bool get _isOwner => _playlist?.userId == ref.read(authControllerProvider).userId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final playlist = await ref.read(playlistsRepositoryProvider).fetchPlaylist(widget.playlistId);
      if (mounted) setState(() => _playlist = playlist);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _addVideo() async {
    final userId = ref.read(authControllerProvider).userId!;
    List<VideoModel> myVideos;
    try {
      myVideos = (await ref.read(videoRepositoryProvider).fetchUserVideos(userId)).videos;
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      return;
    }

    if (!mounted) return;
    final selected = await showModalBottomSheet<VideoModel>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final video in myVideos)
              ListTile(
                title: Text(video.caption ?? video.id, maxLines: 1, overflow: TextOverflow.ellipsis),
                onTap: () => Navigator.of(context).pop(video),
              ),
          ],
        ),
      ),
    );
    if (selected == null) return;

    try {
      await ref.read(playlistsRepositoryProvider).addVideo(widget.playlistId, selected.id);
      await _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _removeVideo(String videoId) async {
    try {
      await ref.read(playlistsRepositoryProvider).removeVideo(widget.playlistId, videoId);
      await _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _deletePlaylist() async {
    try {
      await ref.read(playlistsRepositoryProvider).deletePlaylist(widget.playlistId);
      if (mounted) Navigator.of(context).pop();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final playlist = _playlist;
    return Scaffold(
      appBar: AppBar(
        title: Text(playlist?.name ?? 'Playlist'),
        actions: [
          if (_isOwner)
            IconButton(icon: const Icon(Icons.delete_outline), onPressed: _deletePlaylist),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : ListView(
                  children: [
                    if (playlist!.description != null)
                      Padding(padding: const EdgeInsets.all(16), child: Text(playlist.description!)),
                    for (final videoId in playlist.videoIds)
                      ListTile(
                        leading: const Icon(Icons.play_circle_outline),
                        title: Text(videoId, maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: _isOwner
                            ? IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: () => _removeVideo(videoId))
                            : null,
                      ),
                    if (playlist.videoIds.isEmpty)
                      const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No videos in this playlist yet'))),
                  ],
                ),
      floatingActionButton: _isOwner ? FloatingActionButton(onPressed: _addVideo, child: const Icon(Icons.add)) : null,
    );
  }
}
