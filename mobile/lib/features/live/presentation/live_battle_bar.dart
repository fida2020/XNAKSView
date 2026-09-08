import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../domain/live_match_model.dart';
import 'live_providers.dart';

/// LIVE Match/Battle (TikTok-style) — polls the session's current
/// PENDING/ACTIVE match (see `GET /live/:id/match`, added because
/// `LiveSession` has no back-reference to `LiveMatch`) and renders the
/// scoreboard when one exists. Score/Battle state is entirely separate
/// from the Coin/Diamond ledgers — a Gift sent mid-Battle contributes to a
/// side server-side, but this widget only ever displays `scoreA`/`scoreB`,
/// never a Coin amount.
class LiveBattleBar extends ConsumerStatefulWidget {
  const LiveBattleBar({super.key, required this.liveSessionId, required this.isHost, this.hostSessionId});

  final String liveSessionId;
  final bool isHost;

  /// Only meaningful for the host, to distinguish "my session is side A or
  /// B" once a match exists — for a viewer this is unused (viewers only
  /// display the scoreboard, never challenge/accept/decline).
  final String? hostSessionId;

  @override
  ConsumerState<LiveBattleBar> createState() => LiveBattleBarState();
}

class LiveBattleBarState extends ConsumerState<LiveBattleBar> {
  LiveMatchModel? _match;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _poll();
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) => _poll());
  }

  Future<void> _poll() async {
    try {
      final match = await ref.read(liveRepositoryProvider).fetchCurrentMatch(widget.liveSessionId);
      if (mounted) setState(() => _match = match);
    } on AppException {
      // Best-effort background poll.
    }
  }

  Future<void> openChallengePicker(BuildContext context, {bool asTeamMatch = false}) async {
    final opponent = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => _OpponentPicker(excludeSessionId: widget.liveSessionId, title: asTeamMatch ? 'Start a Team Battle' : 'Challenge a LIVE host'),
    );
    if (opponent == null) return;
    try {
      await ref.read(liveRepositoryProvider).challengeSession(
        widget.liveSessionId,
        opponentSessionId: opponent,
        matchType: asTeamMatch ? LiveMatchType.team : LiveMatchType.solo,
      );
      _poll();
    } on AppException catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _inviteTeammate(BuildContext context, String side) async {
    final match = _match;
    if (match == null) return;
    final targetSessionId = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => _OpponentPicker(excludeSessionId: widget.liveSessionId, title: 'Invite a teammate'),
    );
    if (targetSessionId == null) return;
    try {
      await ref.read(liveRepositoryProvider).inviteTeamMember(match.id, liveSessionId: targetSessionId, side: side);
      _poll();
    } on AppException catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _respondToTeamInvite(LiveMatchTeamMemberModel member, bool accept) async {
    try {
      if (accept) {
        await ref.read(liveRepositoryProvider).acceptTeamInvite(member.id);
      } else {
        await ref.read(liveRepositoryProvider).declineTeamInvite(member.id);
      }
      _poll();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _leaveTeam(LiveMatchTeamMemberModel member) async {
    try {
      await ref.read(liveRepositoryProvider).leaveTeamMatch(member.id);
      _poll();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _removeTeammate(BuildContext context, LiveMatchTeamMemberModel member) async {
    try {
      await ref.read(liveRepositoryProvider).removeTeamMember(member.id);
      _poll();
    } on AppException catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _respond(bool accept) async {
    final match = _match;
    if (match == null) return;
    try {
      if (accept) {
        await ref.read(liveRepositoryProvider).acceptMatch(match.id);
      } else {
        await ref.read(liveRepositoryProvider).declineMatch(match.id);
      }
      _poll();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _support(String side) async {
    final match = _match;
    if (match == null || match.status != LiveMatchStatus.active) return;
    try {
      final updated = await ref.read(liveRepositoryProvider).scoreMatch(match.id, side: side);
      if (mounted) setState(() => _match = updated);
    } on AppException {
      // A tap-to-support failing silently is preferable to interrupting the LIVE.
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final match = _match;
    if (match == null) return const SizedBox.shrink();

    final isTeam = match.matchType == LiveMatchType.team;
    final myTeamMembership = isTeam && widget.hostSessionId != null
        ? match.teamMembers.where((m) => m.liveSessionId == widget.hostSessionId).cast<LiveMatchTeamMemberModel?>().firstWhere((_) => true, orElse: () => null)
        : null;

    final mySide = widget.hostSessionId == match.sessionAId
        ? 'A'
        : (widget.hostSessionId == match.sessionBId ? 'B' : myTeamMembership?.side);
    final isChallengedHost = widget.isHost && match.status == LiveMatchStatus.pending && widget.hostSessionId == match.sessionBId;
    final isCaptain = widget.hostSessionId == match.sessionAId || widget.hostSessionId == match.sessionBId;
    final hasPendingTeamInvite = widget.isHost && myTeamMembership?.status == LiveMatchTeamMemberStatus.invited;
    final isActiveTeammate = widget.isHost && myTeamMembership?.status == LiveMatchTeamMemberStatus.active;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [XnakColors.magenta, XnakColors.violet]),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isTeam)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('TEAM BATTLE', style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 1)),
            ),
          if (match.status == LiveMatchStatus.pending && !isChallengedHost && !hasPendingTeamInvite)
            const Text('Battle request sent — waiting for a response…', style: TextStyle(color: Colors.white, fontSize: 12)),
          if (isChallengedHost)
            Row(
              children: [
                const Expanded(child: Text('Battle challenge received', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                TextButton(onPressed: () => _respond(false), child: const Text('Decline', style: TextStyle(color: Colors.white70))),
                FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: XnakColors.violet), onPressed: () => _respond(true), child: const Text('Accept')),
              ],
            ),
          if (hasPendingTeamInvite)
            Row(
              children: [
                const Expanded(child: Text('Team Battle invitation received', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                TextButton(onPressed: () => _respondToTeamInvite(myTeamMembership!, false), child: const Text('Decline', style: TextStyle(color: Colors.white70))),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: XnakColors.violet),
                  onPressed: () => _respondToTeamInvite(myTeamMembership!, true),
                  child: const Text('Join Team'),
                ),
              ],
            ),
          if (match.status == LiveMatchStatus.active || (isTeam && match.status == LiveMatchStatus.pending))
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: GestureDetector(onTap: () => _support('A'), child: Center(child: _ScoreBadge(score: match.scoreA)))),
                if (match.status == LiveMatchStatus.active)
                  Column(
                    children: [
                      const Icon(Icons.bolt, color: Colors.white, size: 18),
                      Text(_formatSeconds(match.secondsRemaining()), style: const TextStyle(color: Colors.white, fontSize: 11)),
                    ],
                  ),
                Expanded(child: GestureDetector(onTap: () => _support('B'), child: Center(child: _ScoreBadge(score: match.scoreB)))),
              ],
            ),
          if (isTeam)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(child: _TeamRoster(members: match.teammatesForSide('A'), canManage: widget.hostSessionId == match.sessionAId, onRemove: (m) => _removeTeammate(context, m))),
                  Expanded(child: _TeamRoster(members: match.teammatesForSide('B'), canManage: widget.hostSessionId == match.sessionBId, alignEnd: true, onRemove: (m) => _removeTeammate(context, m))),
                ],
              ),
            ),
          if (isTeam && isCaptain && (match.status == LiveMatchStatus.pending || match.status == LiveMatchStatus.active))
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: TextButton.icon(
                onPressed: () => _inviteTeammate(context, mySide!),
                icon: const Icon(Icons.person_add_alt_1, color: Colors.white, size: 16),
                label: const Text('Invite teammate', style: TextStyle(color: Colors.white, fontSize: 12)),
              ),
            ),
          if (isActiveTeammate)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: TextButton(
                onPressed: () => _leaveTeam(myTeamMembership!),
                child: const Text('Leave Team Battle', style: TextStyle(color: Colors.white70, fontSize: 12)),
              ),
            ),
        ],
      ),
    );
  }

  String _formatSeconds(int? seconds) {
    if (seconds == null) return '--:--';
    final minutes = seconds ~/ 60;
    final rest = seconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${rest.toString().padLeft(2, '0')}';
  }
}

class _ScoreBadge extends StatelessWidget {
  const _ScoreBadge({required this.score});
  final int score;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(20)),
      child: Text('$score', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
    );
  }
}

class _OpponentPicker extends ConsumerWidget {
  const _OpponentPicker({required this.excludeSessionId, this.title = 'Challenge a LIVE host'});
  final String excludeSessionId;
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: FutureBuilder(
        future: ref.read(liveRepositoryProvider).discover(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
          }
          final sessions = snapshot.data!.liveSessions.where((s) => s.id != excludeSessionId).toList();
          if (sessions.isEmpty) {
            return const SizedBox(height: 120, child: Center(child: Text('No other LIVE sessions available right now.')));
          }
          return ListView(
            shrinkWrap: true,
            children: [
              Padding(padding: const EdgeInsets.all(16), child: Text(title, style: const TextStyle(fontWeight: FontWeight.bold))),
              for (final session in sessions)
                ListTile(
                  leading: const Icon(Icons.live_tv, color: XnakColors.magenta),
                  title: Text(session.title),
                  subtitle: Text(session.host?.displayLabel ?? 'Unknown host'),
                  onTap: () => Navigator.of(context).pop(session.id),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// A side's teammate roster within a Team Battle — small chips, tap-and-hold
/// to remove for the side's captain, non-interactive for everyone else.
class _TeamRoster extends StatelessWidget {
  const _TeamRoster({required this.members, required this.canManage, required this.onRemove, this.alignEnd = false});

  final List<LiveMatchTeamMemberModel> members;
  final bool canManage;
  final bool alignEnd;
  final void Function(LiveMatchTeamMemberModel member) onRemove;

  @override
  Widget build(BuildContext context) {
    final visible = members.where((m) => m.status == LiveMatchTeamMemberStatus.active || m.status == LiveMatchTeamMemberStatus.invited).toList();
    if (visible.isEmpty) return const SizedBox.shrink();

    return Wrap(
      alignment: alignEnd ? WrapAlignment.end : WrapAlignment.start,
      spacing: 4,
      runSpacing: 4,
      children: [
        for (final member in visible)
          GestureDetector(
            onLongPress: canManage && member.status == LiveMatchTeamMemberStatus.active ? () => onRemove(member) : null,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: member.status == LiveMatchTeamMemberStatus.invited ? 0.08 : 0.18),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                member.status == LiveMatchTeamMemberStatus.invited ? 'Invited…' : 'Teammate',
                style: const TextStyle(color: Colors.white, fontSize: 10),
              ),
            ),
          ),
      ],
    );
  }
}
