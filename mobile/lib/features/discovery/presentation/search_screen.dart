import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../video/presentation/feed_controller.dart';
import '../../video/presentation/hashtag_screen.dart';
import '../../video/presentation/video_page_view.dart';
import '../data/discovery_repository.dart';
import 'discovery_providers.dart';

/// Search / Discovery (Step 6, brief J): users, videos, hashtags, recent
/// searches with clear, and (per the request's `type` split) one search bar
/// with category tabs rather than three separate screens.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.autofocus = true});

  /// False when embedded as the Discover bottom-nav tab (TikTok never pops
  /// the keyboard open just from switching to that tab); true for the
  /// pushed, full-screen search entered from a search icon elsewhere.
  final bool autofocus;

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 3, vsync: this);
  final _controller = TextEditingController();
  Timer? _debounce;
  String _query = '';

  List<SearchUserResult> _users = [];
  List<HashtagResult> _hashtags = [];
  bool _isSearching = false;
  List<RecentSearchItem> _recent = [];

  @override
  void initState() {
    super.initState();
    _loadRecent();
  }

  Future<void> _loadRecent() async {
    try {
      final recent = await ref.read(discoveryRepositoryProvider).fetchRecentSearches();
      if (mounted) setState(() => _recent = recent);
    } on AppException {
      // Best-effort.
    }
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _runSearch(value));
  }

  Future<void> _runSearch(String value) async {
    final trimmed = value.trim();
    setState(() => _query = trimmed);
    if (trimmed.isEmpty) return;

    setState(() => _isSearching = true);
    try {
      final repository = ref.read(discoveryRepositoryProvider);
      final results = await Future.wait([repository.searchUsers(trimmed), repository.searchHashtags(trimmed)]);
      ref.read(searchVideosControllerProvider(trimmed).notifier).loadInitial();
      if (mounted) {
        setState(() {
          _users = results[0] as List<SearchUserResult>;
          _hashtags = results[1] as List<HashtagResult>;
        });
      }
      unawaited(_loadRecent());
    } on AppException {
      // Leave prior results in place on failure.
    } finally {
      if (mounted) setState(() => _isSearching = false);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          autofocus: widget.autofocus,
          decoration: const InputDecoration(hintText: 'Search XNAKView', border: InputBorder.none),
          onChanged: _onChanged,
          onSubmitted: _runSearch,
        ),
        bottom: TabBar(controller: _tabController, tabs: const [Tab(text: 'Users'), Tab(text: 'Videos'), Tab(text: 'Hashtags')]),
      ),
      body: _query.isEmpty ? _buildRecent() : _buildResults(),
    );
  }

  Widget _buildRecent() {
    if (_recent.isEmpty) {
      return const Center(child: Text('No recent searches'));
    }
    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Recent searches', style: TextStyle(fontWeight: FontWeight.bold)),
              TextButton(
                onPressed: () async {
                  await ref.read(discoveryRepositoryProvider).clearRecentSearches();
                  if (mounted) setState(() => _recent = []);
                },
                child: const Text('Clear all'),
              ),
            ],
          ),
        ),
        for (final item in _recent)
          ListTile(
            leading: const Icon(Icons.history),
            title: Text(item.query),
            trailing: IconButton(
              icon: const Icon(Icons.close, size: 18),
              onPressed: () async {
                await ref.read(discoveryRepositoryProvider).deleteRecentSearch(item.id);
                if (mounted) setState(() => _recent.removeWhere((r) => r.id == item.id));
              },
            ),
            onTap: () {
              _controller.text = item.query;
              _runSearch(item.query);
            },
          ),
      ],
    );
  }

  Widget _buildResults() {
    if (_isSearching) return const Center(child: CircularProgressIndicator());
    return TabBarView(
      controller: _tabController,
      children: [
        _users.isEmpty
            ? const Center(child: Text('No users found'))
            : ListView(
                children: [
                  for (final user in _users)
                    ListTile(
                      leading: CircleAvatar(
                        backgroundImage: user.avatarUrl != null ? NetworkImage(user.avatarUrl!) : null,
                        child: user.avatarUrl == null ? const Icon(Icons.person) : null,
                      ),
                      title: Text(user.displayLabel),
                      subtitle: Text('${user.followerCount} followers'),
                      onTap: () => context.pushCreatorProfile(user.id),
                    ),
                ],
              ),
        Consumer(
          builder: (context, ref, _) {
            final state = ref.watch(searchVideosControllerProvider(_query));
            if (state.videos.isEmpty && state.status == FeedLoadStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (state.videos.isEmpty) return const Center(child: Text('No videos found'));
            return GridView.builder(
              padding: const EdgeInsets.all(2),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 2,
                mainAxisSpacing: 2,
                childAspectRatio: 9 / 16,
              ),
              itemCount: state.videos.length,
              itemBuilder: (context, index) {
                final video = state.videos[index];
                return GestureDetector(
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (context) => Scaffold(
                        backgroundColor: Colors.black,
                        body: VideoPageView(controllerProvider: searchVideosControllerProvider(_query), initialIndex: index),
                      ),
                    ),
                  ),
                  child: video.thumbnailUrl == null
                      ? Container(color: Colors.black12, child: const Icon(Icons.hourglass_empty))
                      : _AuthenticatedThumbnail(path: video.thumbnailUrl!),
                );
              },
            );
          },
        ),
        _hashtags.isEmpty
            ? const Center(child: Text('No hashtags found'))
            : ListView(
                children: [
                  for (final hashtag in _hashtags)
                    ListTile(
                      leading: const CircleAvatar(child: Text('#')),
                      title: Text('#${hashtag.tag}'),
                      subtitle: Text('${hashtag.postCount} posts'),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (context) => HashtagScreen(tag: hashtag.tag)),
                      ),
                    ),
                ],
              ),
      ],
    );
  }
}

class _AuthenticatedThumbnail extends ConsumerWidget {
  const _AuthenticatedThumbnail({required this.path});

  final String path;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<String?>(
      future: ref.read(secureStorageProvider).read(StorageKeys.accessToken),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox.shrink();
        final uri = AppConfig.resolveMediaUrl(path);
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
