import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/gamification_models.dart';
import 'gamification_providers.dart';

/// Profile → Badges. Server-authoritative earned badges only (see backend
/// `UserBadge`) — there is no client-side "fake" badge, and nothing here is
/// hard-coded; every badge shown came from the backend's own catalog.
class BadgesScreen extends ConsumerWidget {
  const BadgesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final badgesAsync = ref.watch(badgesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Badges')),
      body: badgesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => AppErrorWidget(
          message: error is AppException ? error.message : 'Failed to load badges',
          onRetry: () => ref.invalidate(badgesProvider),
        ),
        data: (badges) {
          if (badges.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('No badges yet — keep creating, hosting LIVE, and engaging to earn your first one.', textAlign: TextAlign.center),
              ),
            );
          }
          return GridView.builder(
            padding: const EdgeInsets.all(16),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: 0.85),
            itemCount: badges.length,
            itemBuilder: (context, index) => _BadgeTile(badge: badges[index]),
          );
        },
      ),
    );
  }
}

class _BadgeTile extends StatelessWidget {
  const _BadgeTile({required this.badge});

  final EarnedBadge badge;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(badge.name),
          content: Text(badge.description),
          actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close'))],
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(gradient: XnakColors.goldGradient, shape: BoxShape.circle),
            child: const Icon(Icons.military_tech, color: Colors.white, size: 32),
          ),
          const SizedBox(height: 8),
          Text(badge.name, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
