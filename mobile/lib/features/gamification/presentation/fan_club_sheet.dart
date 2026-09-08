import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import 'gamification_providers.dart';

/// LIVE → Fan Club. XNAKView's own configurable equivalent of TikTok LIVE's
/// Fan Club (join, fan level/XP, badge) — TikTok discloses the feature but
/// not its exact scoring formula, so every number shown here is whatever
/// XNAKView's own backend computed (see `lib/gamification/fanClub.ts`).
Future<void> showFanClubSheet(BuildContext context, WidgetRef ref, {required String creatorId}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _FanClubSheet(creatorId: creatorId),
  );
}

class _FanClubSheet extends ConsumerStatefulWidget {
  const _FanClubSheet({required this.creatorId});

  final String creatorId;

  @override
  ConsumerState<_FanClubSheet> createState() => _FanClubSheetState();
}

class _FanClubSheetState extends ConsumerState<_FanClubSheet> {
  bool _busy = false;

  Future<void> _join() async {
    setState(() => _busy = true);
    try {
      await ref.read(gamificationRepositoryProvider).joinFanClub(widget.creatorId);
      ref.invalidate(fanClubProvider(widget.creatorId));
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _leave() async {
    setState(() => _busy = true);
    try {
      await ref.read(gamificationRepositoryProvider).leaveFanClub(widget.creatorId);
      ref.invalidate(fanClubProvider(widget.creatorId));
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fanClubAsync = ref.watch(fanClubProvider(widget.creatorId));

    return Container(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 24),
      decoration: const BoxDecoration(
        gradient: XnakColors.brandGradient,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: fanClubAsync.when(
        loading: () => const SizedBox(height: 140, child: Center(child: CircularProgressIndicator(color: Colors.white))),
        error: (error, _) => SizedBox(
          height: 100,
          child: Center(child: Text(error is AppException ? error.message : 'Failed to load Fan Club', style: const TextStyle(color: Colors.white))),
        ),
        data: (fanClub) {
          if (!fanClub.exists) {
            return const SizedBox(height: 100, child: Center(child: Text('This creator has not started a Fan Club yet.', style: TextStyle(color: Colors.white))));
          }
          final membership = fanClub.membership;
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(fanClub.badgeEmoji ?? '🎗️', style: const TextStyle(fontSize: 28)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(fanClub.name ?? 'Fan Club', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('${fanClub.memberCount ?? 0} members', style: const TextStyle(color: Colors.white70, fontSize: 12)),
              const SizedBox(height: 20),
              if (membership != null) ...[
                Row(
                  children: [
                    CircleAvatar(radius: 22, backgroundColor: Colors.white.withValues(alpha: 0.15), child: Text('${membership.fanLevel}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(6),
                            child: LinearProgressIndicator(value: membership.progress, minHeight: 8, backgroundColor: Colors.white.withValues(alpha: 0.2), valueColor: const AlwaysStoppedAnimation(XnakColors.gold)),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            membership.nextLevelXP == 0 ? 'Max Fan Level reached' : '${membership.fanXP} / ${membership.nextLevelXP} Fan XP',
                            style: const TextStyle(color: Colors.white, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54)),
                    onPressed: _busy ? null : _leave,
                    child: const Text('Leave Fan Club'),
                  ),
                ),
              ] else
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: XnakColors.violet),
                    onPressed: _busy ? null : _join,
                    child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Join Fan Club'),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
