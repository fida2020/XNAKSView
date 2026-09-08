import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/xnak_avatar.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../photopost/presentation/photo_posts_list_screen.dart';
import '../../textpost/presentation/text_posts_list_screen.dart';
import '../domain/user_profile_summary.dart';
import 'feed_controller.dart';
import 'profile_menu_sheet.dart';
import 'video_page_view.dart';
import 'video_providers.dart';

/// Profile — TikTok's structure: avatar/stats/bio header, a full-width
/// Edit-profile-or-Follow action, then a sticky content-type tab strip
/// (Videos/Photos/Text) over a scrolling grid. The menu (☰, self only)
/// opens [showProfileMenu] — every existing XNAKView capability
/// (Coins/XNAKView Studio/Playlists/sign out/etc.) lives there instead of a
/// row of large pill buttons on the header itself.
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
    final profile = _profile;
    return Scaffold(
      appBar: AppBar(
        title: Text(profile?.username != null ? '@${profile!.username}' : (profile?.displayLabel ?? 'Profile')),
        actions: [
          if (profile?.isSelf ?? false)
            IconButton(icon: const Icon(Icons.menu), onPressed: () => showProfileMenu(context, ref)),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : profile == null
                  ? const SizedBox.shrink()
                  : DefaultTabController(
                      length: 3,
                      child: NestedScrollView(
                        headerSliverBuilder: (context, innerBoxIsScrolled) => [
                          SliverToBoxAdapter(child: _ProfileHeader(profile: profile, onFollowToggle: _toggleFollow)),
                          SliverPersistentHeader(
                            pinned: true,
                            delegate: _TabBarDelegate(
                              const TabBar(
                                tabs: [Tab(icon: Icon(Icons.grid_on)), Tab(icon: Icon(Icons.photo_library_outlined)), Tab(icon: Icon(Icons.text_fields))],
                              ),
                            ),
                          ),
                        ],
                        body: TabBarView(
                          children: [
                            _VideoGridTab(userId: profile.id),
                            PhotoPostsGrid(userId: profile.id),
                            TextPostsGrid(userId: profile.id),
                          ],
                        ),
                      ),
                    ),
    );
  }
}

class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  const _TabBarDelegate(this.tabBar);
  final TabBar tabBar;

  @override
  double get minExtent => tabBar.preferredSize.height;
  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return ColoredBox(color: Theme.of(context).scaffoldBackgroundColor, child: tabBar);
  }

  @override
  bool shouldRebuild(covariant _TabBarDelegate oldDelegate) => tabBar != oldDelegate.tabBar;
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.profile, required this.onFollowToggle});

  final UserProfileSummary profile;
  final VoidCallback onFollowToggle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        children: [
          XnakAvatar(avatarUrl: profile.avatarUrl, radius: 44, ringed: true),
          const SizedBox(height: 10),
          Text(profile.displayLabel, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
          if (profile.username != null) Text('@${profile.username}', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 14),
          GestureDetector(
            onTap: () => context.pushFollowers(profile.id),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _CountBlock(label: 'Following', count: profile.followingCount),
                const SizedBox(width: 36),
                _CountBlock(label: 'Followers', count: profile.followerCount),
              ],
            ),
          ),
          if (profile.bio != null && profile.bio!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(profile.bio!, textAlign: TextAlign.center),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: profile.isSelf
                ? OutlinedButton(onPressed: () {}, child: const Text('Edit profile'))
                : FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: (profile.isFollowedByMe ?? false) ? null : XnakColors.magenta,
                    ),
                    onPressed: onFollowToggle,
                    child: Text((profile.isFollowedByMe ?? false) ? 'Following' : 'Follow'),
                  ),
          ),
        ],
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

class _VideoGridTab extends ConsumerWidget {
  const _VideoGridTab({required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(userVideosControllerProvider(userId));

    if (state.videos.isEmpty && state.status == FeedLoadStatus.loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.videos.isEmpty) {
      return const Center(child: Padding(padding: EdgeInsets.all(32), child: Text('No videos yet')));
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(userVideosControllerProvider(userId).notifier).loadInitial(),
      child: GridView.builder(
        padding: const EdgeInsets.all(2),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 2, mainAxisSpacing: 2, childAspectRatio: 9 / 16),
        itemCount: state.videos.length,
        itemBuilder: (context, index) {
          final video = state.videos[index];
          return GestureDetector(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (context) => Scaffold(
                  backgroundColor: Colors.black,
                  body: VideoPageView(controllerProvider: userVideosControllerProvider(userId), initialIndex: index),
                ),
              ),
            ),
            child: video.thumbnailUrl == null
                ? Container(color: Colors.black12, child: const Icon(Icons.hourglass_empty))
                : _AuthenticatedThumbnail(path: video.thumbnailUrl!),
          );
        },
      ),
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
