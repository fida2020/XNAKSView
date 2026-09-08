import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/safety_repository.dart';
import '../domain/safety_models.dart';

final safetyRepositoryProvider = Provider<SafetyRepository>((ref) {
  return SafetyRepository(ref.watch(apiClientProvider));
});

final accountStatusProvider = AsyncNotifierProvider<AccountStatusNotifier, AccountStatusModel>(AccountStatusNotifier.new);

class AccountStatusNotifier extends AsyncNotifier<AccountStatusModel> {
  @override
  Future<AccountStatusModel> build() => ref.watch(safetyRepositoryProvider).fetchAccountStatus();

  Future<void> refresh() async {
    state = AsyncData(await ref.read(safetyRepositoryProvider).fetchAccountStatus());
  }
}
