import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/photo_post_repository.dart';

final photoPostRepositoryProvider = Provider<PhotoPostRepository>((ref) {
  return PhotoPostRepository(ref.watch(apiClientProvider));
});
