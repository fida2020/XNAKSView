import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/playlists_repository.dart';
import 'playlists_providers.dart';

/// Creator Playlists (Step 6, brief N) — LOCKED rule: unlocks at exactly
/// `env.CREATOR_PLAYLIST_MIN_FOLLOWERS` (default 5000) followers, enforced
/// server-side; this screen's locked state is just UI, never the actual gate
/// (a direct API call is what's actually rejected/allowed).
class PlaylistsScreen extends ConsumerStatefulWidget {
  const PlaylistsScreen({super.key, this.userId});

  /// Defaults to the signed-in user's own playlists when omitted.
  final String? userId;

  @override
  ConsumerState<PlaylistsScreen> createState() => _PlaylistsScreenState();
}

class _PlaylistsScreenState extends ConsumerState<PlaylistsScreen> {
  PlaylistEligibility? _eligibility;
  List<PlaylistModel> _playlists = [];
  bool _isLoading = true;
  String? _error;

  String get _targetUserId => widget.userId ?? ref.read(authControllerProvider).userId!;
  bool get _isSelf => _targetUserId == ref.read(authControllerProvider).userId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final repository = ref.read(playlistsRepositoryProvider);
      final results = await Future.wait([
        if (_isSelf) repository.fetchEligibility() else Future.value(null),
        repository.fetchUserPlaylists(_targetUserId),
      ]);
      if (mounted) {
        setState(() {
          _eligibility = results[0] as PlaylistEligibility?;
          _playlists = results[1] as List<PlaylistModel>;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _createPlaylist() async {
    final nameController = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New playlist'),
        content: TextField(controller: nameController, decoration: const InputDecoration(labelText: 'Name')),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(nameController.text.trim()), child: const Text('Create')),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;

    try {
      await ref.read(playlistsRepositoryProvider).createPlaylist(name: name);
      await _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Playlists')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(onRefresh: _load, child: _buildBody()),
      floatingActionButton: _isSelf && (_eligibility?.eligible ?? false)
          ? FloatingActionButton(onPressed: _createPlaylist, child: const Icon(Icons.add))
          : null,
    );
  }

  Widget _buildBody() {
    final eligibility = _eligibility;
    return ListView(
      children: [
        if (_isSelf && eligibility != null && !eligibility.eligible) _buildLockedBanner(eligibility),
        if (_playlists.isEmpty)
          const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No playlists yet')))
        else
          for (final playlist in _playlists)
            ListTile(
              leading: const Icon(Icons.playlist_play),
              title: Text(playlist.name),
              subtitle: playlist.description != null ? Text(playlist.description!) : null,
              trailing: Text('${playlist.viewCount} views'),
              onTap: () => context.pushPlaylistDetail(playlist.id),
            ),
      ],
    );
  }

  Widget _buildLockedBanner(PlaylistEligibility eligibility) {
    final progress = (eligibility.followerCount / eligibility.requiredFollowers).clamp(0.0, 1.0);
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [const Icon(Icons.lock_outline), const SizedBox(width: 8), Text('Creator Playlists locked', style: Theme.of(context).textTheme.titleMedium)]),
          const SizedBox(height: 8),
          Text('Unlocks at ${eligibility.requiredFollowers} followers.'),
          const SizedBox(height: 8),
          LinearProgressIndicator(value: progress),
          const SizedBox(height: 4),
          Text('${eligibility.followerCount} / ${eligibility.requiredFollowers} followers'),
        ],
      ),
    );
  }
}
