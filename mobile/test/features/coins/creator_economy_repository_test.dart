import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/features/coins/data/creator_economy_repository.dart';
import 'package:xnakview/features/coins/domain/creator_economy_models.dart';

import '../../support/fake_api_client.dart';

void main() {
  late FakeApiClient apiClient;
  late CreatorEconomyRepository repository;

  setUp(() {
    apiClient = FakeApiClient();
    repository = CreatorEconomyRepository(apiClient);
  });

  test('Diamonds and Earnings are two separate balances, never merged', () async {
    apiClient.on('GET', '/creator/diamonds', respond: (_, _) => {'balance': 42});
    apiClient.on('GET', '/creator/earnings', respond: (_, _) => {'balanceMinorUnits': 500, 'currency': 'USD'});

    final diamonds = await repository.fetchDiamondBalance();
    final earnings = await repository.fetchEarningsBalance();

    expect(diamonds.balance, 42);
    expect(earnings.balanceMinorUnits, 500);
    expect(earnings.currency, 'USD');
  });

  test('every withdrawal status the backend can return is representable, not just the happy path', () {
    for (final status in ['REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED', 'CANCELLED']) {
      final withdrawal = WithdrawalModel.fromJson({
        'id': 'w1',
        'amountMinorUnits': 5000,
        'currency': 'USD',
        'status': status,
        'rejectionReason': null,
        'createdAt': '2026-01-01T00:00:00.000Z',
        'processedAt': null,
      });
      expect(withdrawal.statusLabel, isNotEmpty, reason: 'status $status should have a display label');
    }
  });

  test('only a REQUESTED withdrawal is cancellable — every other state is final or already in review', () {
    final requested = WithdrawalModel.fromJson({
      'id': 'w1',
      'amountMinorUnits': 5000,
      'currency': 'USD',
      'status': 'REQUESTED',
      'createdAt': '2026-01-01T00:00:00.000Z',
    });
    final approved = WithdrawalModel.fromJson({
      'id': 'w2',
      'amountMinorUnits': 5000,
      'currency': 'USD',
      'status': 'APPROVED',
      'createdAt': '2026-01-01T00:00:00.000Z',
    });

    expect(requested.isCancellable, isTrue);
    expect(approved.isCancellable, isFalse);
  });

  test('requestWithdrawal below the backend minimum surfaces as ForbiddenException, not a silent no-op', () async {
    apiClient.on(
      'POST',
      '/creator/withdrawals',
      throwing: (_, _) => const ForbiddenException('The minimum withdrawal amount is 5000 minor units'),
    );

    expect(
      repository.requestWithdrawal(
        amountMinorUnits: 50,
        currency: 'USD',
        idempotencyKey: 'idem-1',
      ),
      throwsA(isA<ForbiddenException>()),
    );
  });

  test('cancelWithdrawal round-trips the new status', () async {
    apiClient.on('POST', '/creator/withdrawals/w1/cancel', respond: (_, _) => {'id': 'w1', 'status': 'CANCELLED'});

    final result = await repository.cancelWithdrawal('w1');

    expect(result.status, 'CANCELLED');
  });
}
