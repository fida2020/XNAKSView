import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/live_repository.dart';

final liveRepositoryProvider = Provider<LiveRepository>((ref) {
  return LiveRepository(ref.watch(apiClientProvider));
});
