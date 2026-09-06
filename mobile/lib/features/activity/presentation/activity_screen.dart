import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/activity_model.dart';
import 'activity_providers.dart';

/// The Activity/Notifications tab (Step 6, brief O) — a persisted,
/// paginated, read/unread log of social activity (likes, comments, follows,
/// mentions, reposts), distinct from the ephemeral in-app call/message
/// alerts Step 5 already has.
class ActivityScreen extends ConsumerWidget {
  const ActivityScreen({super.key});

  IconData _iconFor(ActivityType type) {
    switch (type) {
      case ActivityType.like:
        return Icons.favorite;
      case ActivityType.comment:
      case ActivityType.commentReply:
        return Icons.mode_comment;
      case ActivityType.commentLike:
        return Icons.thumb_up;
      case ActivityType.follow:
        return Icons.person_add_alt_1;
      case ActivityType.mention:
        return Icons.alternate_email;
      case ActivityType.repost:
        return Icons.repeat;
      case ActivityType.unknown:
        return Icons.notifications;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(activityControllerProvider);
    final controller = ref.read(activityControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Activity'),
        actions: [
          TextButton(
            onPressed: controller.markAllRead,
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: switch (state.status) {
        ActivityLoadStatus.initial || ActivityLoadStatus.loading => const Center(child: CircularProgressIndicator()),
        ActivityLoadStatus.error => Center(child: Text(state.errorMessage ?? 'Something went wrong')),
        _ when state.items.isEmpty => const Center(child: Text('No activity yet')),
        _ => NotificationListener<ScrollNotification>(
            onNotification: (notification) {
              if (notification.metrics.pixels >= notification.metrics.maxScrollExtent - 200) {
                controller.loadMore();
              }
              return false;
            },
            child: ListView.separated(
              itemCount: state.items.length,
              separatorBuilder: (context, index) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final item = state.items[index];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundImage: item.actor?.avatarUrl != null ? NetworkImage(item.actor!.avatarUrl!) : null,
                    child: item.actor?.avatarUrl == null ? Icon(_iconFor(item.type)) : null,
                  ),
                  title: Text(item.message),
                  subtitle: Text(_relativeTime(item.createdAt)),
                  tileColor: item.read ? null : Theme.of(context).colorScheme.primary.withValues(alpha: 0.06),
                  onTap: () => controller.markRead(item.id),
                );
              },
            ),
          ),
      },
    );
  }

  String _relativeTime(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inHours < 1) return '${diff.inMinutes}m ago';
    if (diff.inDays < 1) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}
