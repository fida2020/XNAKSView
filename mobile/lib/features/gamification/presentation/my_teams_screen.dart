import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/team_models.dart';
import 'create_team_screen.dart';
import 'gamification_providers.dart';
import 'team_home_screen.dart';

/// Entry point for LIVE Teams — the caller's current team (if any) plus any
/// pending invites received across every team. A user can be an ACTIVE
/// member of at most one team at a time (see backend `hasActiveTeamMembership`),
/// so this never needs to render a scrollable "my teams" list beyond one.
class MyTeamsScreen extends ConsumerStatefulWidget {
  const MyTeamsScreen({super.key});

  @override
  ConsumerState<MyTeamsScreen> createState() => _MyTeamsScreenState();
}

class _MyTeamsScreenState extends ConsumerState<MyTeamsScreen> {
  late Future<List<TeamModel>> _myTeamsFuture;
  late Future<List<TeamInviteModel>> _invitesFuture;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final repository = ref.read(teamsRepositoryProvider);
    _myTeamsFuture = repository.fetchMyTeams();
    _invitesFuture = repository.fetchReceivedInvites();
  }

  Future<void> _respond(TeamInviteModel invite, bool accept) async {
    try {
      await ref.read(teamsRepositoryProvider).respondToInvite(invite.id, accept);
      setState(_load);
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Team')),
      body: RefreshIndicator(
        onRefresh: () async => setState(_load),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            FutureBuilder<List<TeamModel>>(
              future: _myTeamsFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
                if (snapshot.hasError) {
                  final error = snapshot.error;
                  return AppErrorWidget(message: error is AppException ? error.message : 'Failed to load your team');
                }
                final teams = snapshot.data!;
                if (teams.isEmpty) {
                  return Column(
                    children: [
                      const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Text("You're not on a team yet.", textAlign: TextAlign.center)),
                      FilledButton.icon(
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateTeamScreen())),
                        icon: const Icon(Icons.group_add),
                        label: const Text('Create a Team'),
                      ),
                    ],
                  );
                }
                final team = teams.first;
                return Card(
                  child: ListTile(
                    leading: const CircleAvatar(backgroundColor: XnakColors.violet, child: Icon(Icons.groups, color: Colors.white)),
                    title: Text(team.name),
                    subtitle: Text('${team.memberCount} members · ${team.myRole?.label ?? ''}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TeamHomeScreen(teamId: team.id))).then((_) => setState(_load)),
                  ),
                );
              },
            ),
            const SizedBox(height: 24),
            const Text('Invites', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 8),
            FutureBuilder<List<TeamInviteModel>>(
              future: _invitesFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const SizedBox.shrink();
                if (snapshot.hasError || snapshot.data!.isEmpty) {
                  return const Text('No pending invites.', style: TextStyle(color: Colors.grey));
                }
                return Column(
                  children: snapshot.data!
                      .map(
                        (invite) => Card(
                          child: ListTile(
                            title: Text(invite.team?.name ?? 'Team invite'),
                            subtitle: const Text('Wants you to join'),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(icon: const Icon(Icons.check, color: Colors.green), onPressed: () => _respond(invite, true)),
                                IconButton(icon: const Icon(Icons.close, color: Colors.red), onPressed: () => _respond(invite, false)),
                              ],
                            ),
                          ),
                        ),
                      )
                      .toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
