import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/router/app_router.dart';
import '../../video/domain/video_model.dart';
import 'social_providers.dart';

/// Suggested accounts (Step 6, brief L) — deterministic (most-followed
/// accounts not already followed), no AI/ML ranking, matching the backend's
/// `GET /users/suggested`.
class SuggestedAccountsScreen extends ConsumerStatefulWidget {
  const SuggestedAccountsScreen({super.key});

  @override
  ConsumerState<SuggestedAccountsScreen> createState() => _SuggestedAccountsScreenState();
}

class _SuggestedAccountsScreenState extends ConsumerState<SuggestedAccountsScreen> {
  List<VideoAuthor> _suggestions = [];
  final Set<String> _following = {};
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final suggestions = await ref.read(socialRepositoryProvider).suggestedAccounts();
      if (mounted) setState(() => _suggestions = suggestions);
    } on AppException {
      // Leave the list empty on failure.
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleFollow(VideoAuthor user) async {
    final wasFollowing = _following.contains(user.id);
    setState(() {
      if (wasFollowing) {
        _following.remove(user.id);
      } else {
        _following.add(user.id);
      }
    });
    try {
      final repository = ref.read(socialRepositoryProvider);
      if (wasFollowing) {
        await repository.unfollow(user.id);
      } else {
        await repository.follow(user.id);
      }
    } on AppException {
      setState(() {
        if (wasFollowing) {
          _following.add(user.id);
        } else {
          _following.remove(user.id);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Suggested accounts')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _suggestions.isEmpty
              ? const Center(child: Text('No suggestions right now'))
              : ListView(
                  children: [
                    for (final user in _suggestions)
                      ListTile(
                        leading: CircleAvatar(
                          backgroundImage: user.avatarUrl != null ? NetworkImage(user.avatarUrl!) : null,
                          child: user.avatarUrl == null ? const Icon(Icons.person) : null,
                        ),
                        title: Text(user.displayLabel),
                        trailing: OutlinedButton(
                          onPressed: () => _toggleFollow(user),
                          child: Text(_following.contains(user.id) ? 'Following' : 'Follow'),
                        ),
                        onTap: () => context.pushCreatorProfile(userId: user.id),
                      ),
                  ],
                ),
    );
  }
}
