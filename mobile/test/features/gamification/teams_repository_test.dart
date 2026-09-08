import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/features/gamification/data/teams_repository.dart';
import 'package:xnakview/features/gamification/domain/team_models.dart';

import '../../support/fake_api_client.dart';

void main() {
  late FakeApiClient apiClient;
  late TeamsRepository repository;

  setUp(() {
    apiClient = FakeApiClient();
    repository = TeamsRepository(apiClient);
  });

  test('createTeam returns the server-assigned team, never a client-generated one', () async {
    apiClient.on(
      'POST',
      '/teams',
      respond: (_, data) {
        final body = data as Map<String, dynamic>;
        expect(body['name'], 'The Rockets');
        return {'id': 'team-1', 'name': 'The Rockets', 'status': 'ACTIVE', 'ownerId': 'user-1', 'memberCount': 1};
      },
    );

    final team = await repository.createTeam(name: 'The Rockets');

    expect(team.id, 'team-1');
    expect(team.memberCount, 1);
  });

  test('changeMemberRole sends the exact API enum value, not the Dart enum name', () async {
    apiClient.on(
      'PATCH',
      '/teams/team-1/members/user-2/role',
      respond: (_, data) {
        expect((data as Map<String, dynamic>)['role'], 'MANAGER');
        return {};
      },
    );

    await repository.changeMemberRole('team-1', 'user-2', TeamRole.manager);
  });

  test('fetchTargets surfaces server-computed progress without recomputing it', () async {
    apiClient.on(
      'GET',
      '/teams/team-1/targets',
      respond: (_, _) => {
        'targets': [
          {'id': 't-1', 'metric': 'LIVE_HOURS', 'targetValue': 60, 'currentValue': 30, 'status': 'ACTIVE', 'periodStart': '2026-09-01T00:00:00.000Z', 'periodEnd': '2026-09-08T00:00:00.000Z'},
        ],
      },
    );

    final targets = await repository.fetchTargets('team-1');

    expect(targets, hasLength(1));
    expect(targets.first.progress, closeTo(0.5, 0.001));
  });
}
