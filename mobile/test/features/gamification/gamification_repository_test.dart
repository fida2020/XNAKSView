import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/features/gamification/data/gamification_repository.dart';
import 'package:xnakview/features/gamification/domain/gamification_models.dart';

import '../../support/fake_api_client.dart';

void main() {
  late FakeApiClient apiClient;
  late GamificationRepository repository;

  setUp(() {
    apiClient = FakeApiClient();
    repository = GamificationRepository(apiClient);
  });

  group('fetchUserLevel', () {
    test('returns exactly the server-computed level snapshot — no client-side XP math', () async {
      apiClient.on(
        'GET',
        '/gamification/level',
        respond: (_, _) => {'currentLevel': 3, 'currentXP': 40, 'lifetimeXP': 340, 'nextLevelXP': 100},
      );

      final level = await repository.fetchUserLevel();

      expect(level.currentLevel, 3);
      expect(level.progress, closeTo(0.4, 0.001));
    });

    test('never divides by zero once the max configured level is reached', () async {
      apiClient.on(
        'GET',
        '/gamification/level',
        respond: (_, _) => {'currentLevel': 50, 'currentXP': 900, 'lifetimeXP': 999999, 'nextLevelXP': 0},
      );

      final level = await repository.fetchUserLevel();

      expect(level.progress, 1.0);
    });
  });

  group('fetchFanClub', () {
    test('a creator with no Fan Club yet reports exists=false, not an error', () async {
      apiClient.on('GET', '/gamification/fan-clubs/creator-1', respond: (_, _) => {'exists': false});

      final view = await repository.fetchFanClub('creator-1');

      expect(view.exists, isFalse);
      expect(view.isMember, isFalse);
    });

    test('a non-member sees the club but membership is null, never a fabricated zero-progress membership', () async {
      apiClient.on(
        'GET',
        '/gamification/fan-clubs/creator-1',
        respond: (_, _) => {'exists': true, 'id': 'fc-1', 'creatorId': 'creator-1', 'name': "Creator's Fan Club", 'badgeEmoji': '🎗️', 'memberCount': 12, 'membership': null},
      );

      final view = await repository.fetchFanClub('creator-1');

      expect(view.exists, isTrue);
      expect(view.isMember, isFalse);
      expect(view.memberCount, 12);
    });
  });

  group('fetchLeaderboard', () {
    test('sends the type/period using the API enum values', () async {
      apiClient.on(
        'GET',
        '/gamification/leaderboards',
        respond: (query, _) {
          expect(query!['type'], 'GIFT_SENDERS');
          expect(query['period'], 'WEEKLY');
          return {
            'type': 'GIFT_SENDERS',
            'period': 'WEEKLY',
            'periodKey': '2026-W36',
            'computedAt': '2026-09-08T00:00:00.000Z',
            'entries': [
              {'subjectId': 'user-1', 'rank': 1, 'score': '500'},
            ],
          };
        },
      );

      final result = await repository.fetchLeaderboard(type: LeaderboardType.giftSenders, period: LeaderboardPeriod.weekly);

      expect(result.entries, hasLength(1));
      expect(result.entries.first.rank, 1);
      expect(result.entries.first.score, '500');
    });
  });
}
