import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/gamification_models.dart';
import 'gamification_providers.dart';

/// Profile → Achievements. Every achievement's progress bar reflects a
/// server-computed `progressValue`/target (see backend
/// `lib/gamification/achievementRules.ts`) — never a client guess.
class AchievementsScreen extends ConsumerWidget {
  const AchievementsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final achievementsAsync = ref.watch(achievementsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Achievements')),
      body: achievementsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => AppErrorWidget(
          message: error is AppException ? error.message : 'Failed to load achievements',
          onRetry: () => ref.invalidate(achievementsProvider),
        ),
        data: (achievements) {
          if (achievements.isEmpty) {
            return const Center(child: Text('No achievements configured yet.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: achievements.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, index) => _AchievementTile(achievement: achievements[index]),
          );
        },
      ),
    );
  }
}

class _AchievementTile extends StatelessWidget {
  const _AchievementTile({required this.achievement});

  final AchievementProgress achievement;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(16),
        color: achievement.isUnlocked ? XnakColors.gold.withValues(alpha: 0.08) : null,
      ),
      child: Row(
        children: [
          Icon(achievement.isUnlocked ? Icons.emoji_events : Icons.emoji_events_outlined, color: achievement.isUnlocked ? XnakColors.gold : Colors.grey, size: 32),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(achievement.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(achievement.description, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                if (!achievement.isUnlocked && achievement.progressValue > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text('Progress: ${achievement.progressValue}', style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  ),
                if (achievement.xpReward > 0)
                  Padding(padding: const EdgeInsets.only(top: 6), child: Text('+${achievement.xpReward} XP', style: const TextStyle(fontSize: 11, color: XnakColors.violet, fontWeight: FontWeight.w600))),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
