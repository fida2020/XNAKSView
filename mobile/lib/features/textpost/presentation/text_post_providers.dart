import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/text_post_repository.dart';

final textPostRepositoryProvider = Provider<TextPostRepository>((ref) {
  return TextPostRepository(ref.watch(apiClientProvider));
});
