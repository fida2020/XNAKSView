import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../video/domain/video_model.dart';
import 'social_providers.dart';

/// Followers/following management (Step 6, brief L) — a profile owner can
/// remove a follower here; anyone can browse either list and jump to a
/// profile.
class FollowersScreen extends ConsumerStatefulWidget {
  const FollowersScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<FollowersScreen> createState() => _FollowersScreenState();
}

class _FollowersScreenState extends ConsumerState<FollowersScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 2, vsync: this);
  List<VideoAuthor> _followers = [];
  List<VideoAuthor> _following = [];
  bool _isLoading = true;

  bool get _isSelf => widget.userId == ref.read(authControllerProvider).userId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final repository = ref.read(socialRepositoryProvider);
      final results = await Future.wait([repository.fetchFollowers(widget.userId), repository.fetchFollowing(widget.userId)]);
      if (mounted) {
        setState(() {
          _followers = results[0];
          _following = results[1];
        });
      }
    } on AppException {
      // Leave lists empty on failure.
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _removeFollower(VideoAuthor follower) async {
    try {
      await ref.read(socialRepositoryProvider).removeFollower(widget.userId, follower.id);
      if (mounted) setState(() => _followers.removeWhere((f) => f.id == follower.id));
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Followers'),
        bottom: TabBar(controller: _tabController, tabs: const [Tab(text: 'Followers'), Tab(text: 'Following')]),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : TabBarView(
              controller: _tabController,
              children: [
                _buildList(_followers, showRemove: _isSelf),
                _buildList(_following, showRemove: false),
              ],
            ),
    );
  }

  Widget _buildList(List<VideoAuthor> users, {required bool showRemove}) {
    if (users.isEmpty) return const Center(child: Text('Nobody here yet'));
    return ListView(
      children: [
        for (final user in users)
          ListTile(
            leading: CircleAvatar(
              backgroundImage: user.avatarUrl != null ? NetworkImage(user.avatarUrl!) : null,
              child: user.avatarUrl == null ? const Icon(Icons.person) : null,
            ),
            title: Text(user.displayLabel),
            trailing: showRemove ? TextButton(onPressed: () => _removeFollower(user), child: const Text('Remove')) : null,
            onTap: () => context.pushCreatorProfile(userId: user.id),
          ),
      ],
    );
  }
}
