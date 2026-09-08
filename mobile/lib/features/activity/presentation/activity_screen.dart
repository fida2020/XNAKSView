import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/xnak_avatar.dart';
import '../domain/activity_model.dart';
import 'activity_providers.dart';

/// Standalone Activity screen — kept for any deep link/back-compat need;
/// the TikTok-style Inbox screen embeds [ActivityBody] directly as one of
/// its tabs instead of pushing this.
class ActivityScreen extends StatelessWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: const ActivityBody(),
    );
  }
}

/// The Activity/Notifications content (Step 6, brief O) — a persisted,
/// paginated, read/unread log of social activity (likes, comments, follows,
/// mentions, reposts), distinct from the ephemeral in-app call/message
/// alerts Step 5 already has. No `Scaffold`/`AppBar` of its own so it can be
/// embedded as an Inbox tab (TikTok's structure) or pushed standalone.
class ActivityBody extends ConsumerWidget {
  const ActivityBody({super.key});

  static IconData _iconFor(ActivityType type) {
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

    return switch (state.status) {
      ActivityLoadStatus.initial || ActivityLoadStatus.loading => const Center(child: CircularProgressIndicator()),
      ActivityLoadStatus.error => Center(child: Text(state.errorMessage ?? 'Something went wrong')),
      _ when state.items.isEmpty => const Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: Text('No activity yet — likes, comments, and follows will show up here.', textAlign: TextAlign.center),
          ),
        ),
      _ => NotificationListener<ScrollNotification>(
          onNotification: (notification) {
            if (notification.metrics.pixels >= notification.metrics.maxScrollExtent - 200) {
              controller.loadMore();
            }
            return false;
          },
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Activity', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      TextButton(onPressed: controller.markAllRead, child: const Text('Mark all read')),
                    ],
                  ),
                ),
              ),
              for (final group in _groupByDay(state.items))
                SliverMainAxisGroup(
                  slivers: [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                        child: Text(group.label, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                      ),
                    ),
                    SliverList.builder(
                      itemCount: group.items.length,
                      itemBuilder: (context, index) => _ActivityRow(item: group.items[index], onTap: () => controller.markRead(group.items[index].id)),
                    ),
                  ],
                ),
            ],
          ),
        ),
    };
  }

  static List<_ActivityDayGroup> _groupByDay(List<ActivityItem> items) {
    final groups = <String, List<ActivityItem>>{};
    for (final item in items) {
      groups.putIfAbsent(_dayLabel(item.createdAt), () => []).add(item);
    }
    return [for (final entry in groups.entries) _ActivityDayGroup(entry.key, entry.value)];
  }

  static String _dayLabel(DateTime time) {
    final now = DateTime.now();
    final date = DateTime(time.year, time.month, time.day);
    final today = DateTime(now.year, now.month, now.day);
    final diff = today.difference(date).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    if (diff < 7) return 'This week';
    return 'Earlier';
  }
}

class _ActivityDayGroup {
  const _ActivityDayGroup(this.label, this.items);
  final String label;
  final List<ActivityItem> items;
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({required this.item, required this.onTap});

  final ActivityItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        color: item.read ? null : Theme.of(context).colorScheme.primary.withValues(alpha: 0.06),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            Stack(
              children: [
                XnakAvatar(avatarUrl: item.actor?.avatarUrl, radius: 22),
                Positioned(
                  right: -2,
                  bottom: -2,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: XnakColors.magenta,
                      shape: BoxShape.circle,
                      border: Border.all(color: Theme.of(context).scaffoldBackgroundColor, width: 2),
                    ),
                    child: Icon(ActivityBody._iconFor(item.type), size: 11, color: Colors.white),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.message),
                  const SizedBox(height: 2),
                  Text(_relativeTime(item.createdAt), style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
          ],
        ),
      ),
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
