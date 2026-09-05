import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/user_profile_summary.dart';
import 'feed_controller.dart';
import 'video_page_view.dart';
import 'video_providers.dart';

class CreatorProfileScreen extends ConsumerStatefulWidget {
  const CreatorProfileScreen({super.key, this.userId});

  /// Defaults to the signed-in user's own profile when omitted.
  final String? userId;

  @override
  ConsumerState<CreatorProfileScreen> createState() => _CreatorProfileScreenState();
}

class _CreatorProfileScreenState extends ConsumerState<CreatorProfileScreen> {
  UserProfileSummary? _profile;
  bool _isLoading = true;
  String? _error;

  String get _targetUserId => widget.userId ?? ref.read(authControllerProvider).userId!;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final profile = await ref.read(videoRepositoryProvider).fetchUserProfile(_targetUserId);
      if (mounted) setState(() => _profile = profile);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleFollow() async {
    final profile = _profile;
    if (profile == null) return;
    final wasFollowing = profile.isFollowedByMe ?? false;

    setState(() {
      _profile = UserProfileSummary(
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        followerCount: profile.followerCount + (wasFollowing ? -1 : 1),
        followingCount: profile.followingCount,
        isFollowedByMe: !wasFollowing,
        isSelf: profile.isSelf,
      );
    });

    try {
      final repository = ref.read(videoRepositoryProvider);
      if (wasFollowing) {
        await repository.unfollow(profile.id);
      } else {
        await repository.follow(profile.id);
      }
    } on AppException {
      if (mounted) setState(() => _profile = profile);
    }
  }

  @override
  Widget build(BuildContext context) {
    final userId = _targetUserId;
    final videosState = ref.watch(userVideosControllerProvider(userId));

    return Scaffold(
      appBar: AppBar(title: Text(_profile?.displayLabel ?? 'Profile')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(
                  onRefresh: () async {
                    await _load();
                    await ref.read(userVideosControllerProvider(userId).notifier).loadInitial();
                  },
                  child: CustomScrollView(
                    slivers: [
                      SliverToBoxAdapter(child: _buildHeader()),
                      _buildVideoGrid(videosState, userId),
                    ],
                  ),
                ),
    );
  }

  Widget _buildHeader() {
    final profile = _profile!;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          CircleAvatar(
            radius: 40,
            backgroundImage: profile.avatarUrl != null ? NetworkImage(profile.avatarUrl!) : null,
            child: profile.avatarUrl == null ? const Icon(Icons.person, size: 40) : null,
          ),
          const SizedBox(height: 8),
          Text(profile.displayLabel, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          if (profile.bio != null && profile.bio!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(profile.bio!, textAlign: TextAlign.center),
          ],
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _CountBlock(label: 'Followers', count: profile.followerCount),
              const SizedBox(width: 32),
              _CountBlock(label: 'Following', count: profile.followingCount),
            ],
          ),
          if (!profile.isSelf) ...[
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _toggleFollow,
              child: Text((profile.isFollowedByMe ?? false) ? 'Following' : 'Follow'),
            ),
          ],
          if (profile.isSelf) ...[
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
              child: const Text('Sign out'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildVideoGrid(FeedState state, String userId) {
    if (state.videos.isEmpty && state.status == FeedLoadStatus.loading) {
      return const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())));
    }
    if (state.videos.isEmpty) {
      return const SliverToBoxAdapter(
        child: Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No videos yet'))),
      );
    }

    return SliverPadding(
      padding: const EdgeInsets.all(2),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 2,
          mainAxisSpacing: 2,
          childAspectRatio: 9 / 16,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final video = state.videos[index];
            return GestureDetector(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => Scaffold(
                    backgroundColor: Colors.black,
                    body: VideoPageView(
                      controllerProvider: userVideosControllerProvider(userId),
                      initialIndex: index,
                    ),
                  ),
                ),
              ),
              child: video.thumbnailUrl == null
                  ? Container(color: Colors.black12, child: const Icon(Icons.hourglass_empty))
                  : _AuthenticatedThumbnail(path: video.thumbnailUrl!),
            );
          },
          childCount: state.videos.length,
        ),
      ),
    );
  }
}

class _CountBlock extends StatelessWidget {
  const _CountBlock({required this.label, required this.count});

  final String label;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text('$count', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
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
