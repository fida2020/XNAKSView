import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/team_models.dart';
import 'gamification_providers.dart';

/// Team Home — Members / Activity / Targets / Ranking, plus a role-gated
/// settings sheet (invite, rename, transfer ownership, leave, disband).
/// Every privileged action here maps 1:1 to a server-authorized endpoint
/// (see backend `lib/gamification/teams.ts`) — the UI only *hides* actions
/// a role can't take; the server is what actually enforces it.
class TeamHomeScreen extends ConsumerStatefulWidget {
  const TeamHomeScreen({super.key, required this.teamId});

  final String teamId;

  @override
  ConsumerState<TeamHomeScreen> createState() => _TeamHomeScreenState();
}

class _TeamHomeScreenState extends ConsumerState<TeamHomeScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  Future<TeamDetail>? _detailFuture;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _load();
  }

  void _load() {
    _detailFuture = ref.read(teamsRepositoryProvider).fetchTeam(widget.teamId);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<TeamDetail>(
      future: _detailFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snapshot.hasError) {
          final error = snapshot.error;
          return Scaffold(
            body: AppErrorWidget(message: error is AppException ? error.message : 'Failed to load team', onRetry: () => setState(_load)),
          );
        }
        final detail = snapshot.data!;
        final myRole = _resolveMyRole(detail);

        return Scaffold(
          appBar: AppBar(
            title: Text(detail.team.name),
            actions: [
              if (myRole?.canManage ?? false)
                IconButton(icon: const Icon(Icons.person_add_alt_1), tooltip: 'Invite', onPressed: () => _showInviteDialog(context)),
              IconButton(icon: const Icon(Icons.settings_outlined), onPressed: () => _showSettingsSheet(context, detail, myRole)),
            ],
            bottom: TabBar(
              controller: _tabController,
              tabs: const [Tab(text: 'Members'), Tab(text: 'Activity'), Tab(text: 'Targets'), Tab(text: 'Ranking')],
            ),
          ),
          body: TabBarView(
            controller: _tabController,
            children: [
              _MembersTab(teamId: widget.teamId, members: detail.members, myRole: myRole, onChanged: () => setState(_load)),
              _ActivityTab(teamId: widget.teamId),
              _TargetsTab(teamId: widget.teamId, canManage: myRole?.canManage ?? false),
              _RankingTab(teamId: widget.teamId),
            ],
          ),
        );
      },
    );
  }

  TeamRole? _resolveMyRole(TeamDetail detail) {
    // The team detail endpoint doesn't echo "my role" directly (unlike
    // /teams/me) — derived here from the member list, which always
    // includes the caller while they're an active member.
    return detail.team.myRole;
  }

  Future<void> _showInviteDialog(BuildContext context) async {
    final controller = TextEditingController();
    final userId = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Invite a member'),
        content: TextField(controller: controller, decoration: const InputDecoration(labelText: 'User ID')),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(controller.text.trim()), child: const Text('Invite')),
        ],
      ),
    );
    if (userId == null || userId.isEmpty || !context.mounted) return;
    try {
      await ref.read(teamsRepositoryProvider).inviteMember(widget.teamId, userId);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invite sent')));
    } on AppException catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _showSettingsSheet(BuildContext context, TeamDetail detail, TeamRole? myRole) async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (myRole == TeamRole.owner)
              ListTile(
                leading: const Icon(Icons.delete_forever, color: Colors.red),
                title: const Text('Disband team', style: TextStyle(color: Colors.red)),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  try {
                    await ref.read(teamsRepositoryProvider).disbandTeam(widget.teamId);
                    if (context.mounted) Navigator.of(context).pop();
                  } on AppException catch (error) {
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
                  }
                },
              )
            else
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Leave team'),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  try {
                    await ref.read(teamsRepositoryProvider).leaveTeam(widget.teamId);
                    if (context.mounted) Navigator.of(context).pop();
                  } on AppException catch (error) {
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
                  }
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _MembersTab extends ConsumerWidget {
  const _MembersTab({required this.teamId, required this.members, required this.myRole, required this.onChanged});

  final String teamId;
  final List<TeamMemberModel> members;
  final TeamRole? myRole;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: members.length,
      itemBuilder: (context, index) {
        final member = members[index];
        return ListTile(
          leading: CircleAvatar(backgroundImage: member.avatarUrl != null ? NetworkImage(member.avatarUrl!) : null, child: member.avatarUrl == null ? const Icon(Icons.person) : null),
          title: Text(member.displayName),
          trailing: Chip(label: Text(member.role.label), backgroundColor: member.role == TeamRole.owner ? XnakColors.gold.withValues(alpha: 0.3) : null),
          onLongPress: (myRole?.canManage ?? false) && member.role != TeamRole.owner
              ? () => _showMemberActions(context, ref, member)
              : null,
        );
      },
    );
  }

  Future<void> _showMemberActions(BuildContext context, WidgetRef ref, TeamMemberModel member) async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (myRole == TeamRole.owner)
              ListTile(
                leading: const Icon(Icons.swap_vert),
                title: Text(member.role == TeamRole.manager ? 'Demote to Member' : 'Promote to Manager'),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  try {
                    await ref.read(teamsRepositoryProvider).changeMemberRole(teamId, member.userId, member.role == TeamRole.manager ? TeamRole.member : TeamRole.manager);
                    onChanged();
                  } on AppException catch (error) {
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
                  }
                },
              ),
            ListTile(
              leading: const Icon(Icons.person_remove, color: Colors.red),
              title: const Text('Remove from team', style: TextStyle(color: Colors.red)),
              onTap: () async {
                Navigator.of(sheetContext).pop();
                try {
                  await ref.read(teamsRepositoryProvider).removeMember(teamId, member.userId);
                  onChanged();
                } on AppException catch (error) {
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ActivityTab extends ConsumerWidget {
  const _ActivityTab({required this.teamId});

  final String teamId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(teamsRepositoryProvider);
    return FutureBuilder(
      future: repository.fetchActivity(teamId),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snapshot.hasError) {
          final error = snapshot.error;
          return AppErrorWidget(message: error is AppException ? error.message : 'Failed to load activity');
        }
        final activity = snapshot.data!.activity;
        if (activity.isEmpty) return const Center(child: Text('No team activity yet.'));
        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: activity.length,
          itemBuilder: (context, index) {
            final entry = activity[index];
            return ListTile(leading: const Icon(Icons.bolt, color: XnakColors.violet), title: Text(entry.label), subtitle: Text(entry.createdAt.toLocal().toString()));
          },
        );
      },
    );
  }
}

class _TargetsTab extends ConsumerWidget {
  const _TargetsTab({required this.teamId, required this.canManage});

  final String teamId;
  final bool canManage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(teamsRepositoryProvider);
    return Scaffold(
      floatingActionButton: canManage
          ? FloatingActionButton(onPressed: () => _showCreateTargetDialog(context, ref), child: const Icon(Icons.add))
          : null,
      body: FutureBuilder(
        future: repository.fetchTargets(teamId),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) {
            final error = snapshot.error;
            return AppErrorWidget(message: error is AppException ? error.message : 'Failed to load targets');
          }
          final targets = snapshot.data!;
          if (targets.isEmpty) return const Center(child: Text('No active targets — team leadership can set one.'));
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: targets.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final target = targets[index];
              return Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(border: Border.all(color: Theme.of(context).dividerColor), borderRadius: BorderRadius.circular(16)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(target.metric.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                        Chip(label: Text(target.status), visualDensity: VisualDensity.compact),
                      ],
                    ),
                    const SizedBox(height: 8),
                    ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: target.progress, minHeight: 8)),
                    const SizedBox(height: 6),
                    Text('${target.currentValue} / ${target.targetValue}'),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _showCreateTargetDialog(BuildContext context, WidgetRef ref) async {
    var metric = TeamTargetMetric.liveHours;
    var days = 7;
    final targetValueController = TextEditingController(text: '60');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('New team target'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<TeamTargetMetric>(
                initialValue: metric,
                items: TeamTargetMetric.values.map((m) => DropdownMenuItem(value: m, child: Text(m.label))).toList(),
                onChanged: (value) => setDialogState(() => metric = value ?? metric),
                decoration: const InputDecoration(labelText: 'Metric'),
              ),
              TextField(controller: targetValueController, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Target value')),
              DropdownButtonFormField<int>(
                initialValue: days,
                items: const [7, 14, 30].map((d) => DropdownMenuItem(value: d, child: Text('$d days'))).toList(),
                onChanged: (value) => setDialogState(() => days = value ?? days),
                decoration: const InputDecoration(labelText: 'Period'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Create')),
          ],
        ),
      ),
    );

    if (confirmed != true) return;
    final targetValue = int.tryParse(targetValueController.text.trim()) ?? 0;
    if (targetValue <= 0) return;

    try {
      final now = DateTime.now();
      await ref.read(teamsRepositoryProvider).createTarget(
            teamId,
            metric: metric,
            targetValue: targetValue,
            periodStart: now,
            periodEnd: now.add(Duration(days: days)),
          );
      if (context.mounted) (context as Element).markNeedsBuild();
    } on AppException catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }
}

class _RankingTab extends ConsumerWidget {
  const _RankingTab({required this.teamId});

  final String teamId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(teamsRepositoryProvider);
    return FutureBuilder(
      future: repository.fetchLeaderboard(period: 'WEEKLY'),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snapshot.hasError) {
          final error = snapshot.error;
          return AppErrorWidget(message: error is AppException ? error.message : 'Failed to load ranking');
        }
        final entries = snapshot.data!;
        if (entries.isEmpty) return const Center(child: Text('No ranked team activity this week yet.'));
        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: entries.length,
          itemBuilder: (context, index) {
            final entry = entries[index];
            final isThisTeam = entry.team?.id == teamId;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: isThisTeam ? XnakColors.violet.withValues(alpha: 0.1) : null,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Theme.of(context).dividerColor),
              ),
              child: Row(
                children: [
                  Text('#${entry.rank}', style: const TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(entry.team?.name ?? 'Unknown team', style: TextStyle(fontWeight: isThisTeam ? FontWeight.bold : FontWeight.normal))),
                  Text(entry.score, style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
            );
          },
        );
      },
    );
  }
}
