import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../domain/gamification_models.dart';
import 'achievements_screen.dart';
import 'badges_screen.dart';
import 'gamification_providers.dart';

/// Profile → Level. Shows both the User Level (general platform activity)
/// and the Creator Level (LIVE/audience-facing activity) — two separate,
/// server-computed ledgers (see backend `UserLevel`/`CreatorLevel`), never
/// conflated into one number. Entry points to Badges and Achievements live
/// here rather than as separate top-level tabs.
class LevelScreen extends ConsumerWidget {
  const LevelScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Level & Progress')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _LevelCard(title: 'User Level', subtitle: 'From platform activity — follows, LIVE, content, gifts', provider: userLevelProvider),
          const SizedBox(height: 16),
          _LevelCard(title: 'Creator Level', subtitle: 'From your LIVE and audience activity', provider: creatorLevelProvider),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: _NavTile(
                  icon: Icons.military_tech,
                  label: 'Badges',
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BadgesScreen())),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _NavTile(
                  icon: Icons.flag,
                  label: 'Achievements',
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AchievementsScreen())),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LevelCard extends ConsumerWidget {
  const _LevelCard({required this.title, required this.subtitle, required this.provider});

  final String title;
  final String subtitle;
  final ProviderListenable<AsyncValue<LevelState>> provider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final levelAsync = ref.watch(provider);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(gradient: XnakColors.brandGradient, borderRadius: BorderRadius.circular(20)),
      child: levelAsync.when(
        loading: () => const SizedBox(height: 96, child: Center(child: CircularProgressIndicator(color: Colors.white))),
        error: (error, _) => SizedBox(
          height: 96,
          child: Center(child: Text(error is AppException ? error.message : 'Failed to load', style: const TextStyle(color: Colors.white))),
        ),
        data: (level) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(subtitle, style: const TextStyle(color: Colors.white54, fontSize: 11)),
            const SizedBox(height: 16),
            Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: Colors.white.withValues(alpha: 0.15),
                  child: Text('${level.currentLevel}', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: LinearProgressIndicator(
                          value: level.progress,
                          minHeight: 10,
                          backgroundColor: Colors.white.withValues(alpha: 0.2),
                          valueColor: const AlwaysStoppedAnimation(XnakColors.gold),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        level.nextLevelXP == 0
                            ? '${level.lifetimeXP} lifetime XP · Max level reached'
                            : '${level.currentXP} / ${level.nextLevelXP} XP to next level',
                        style: const TextStyle(color: Colors.white, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _NavTile extends StatelessWidget {
  const _NavTile({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 20),
        decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).dividerColor),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Icon(icon, color: XnakColors.violet, size: 28),
            const SizedBox(height: 8),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
