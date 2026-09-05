import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_controller.dart';
import 'api_client.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  return DioApiClient(secureStorage: ref.watch(secureStorageProvider));
});
