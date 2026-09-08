import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../../core/storage/secure_storage.dart';
import '../data/messaging_repository.dart';
import '../data/realtime_client.dart';

final messagingRepositoryProvider = Provider<MessagingRepository>((ref) {
  return MessagingRepository(ref.watch(apiClientProvider));
});

/// One socket connection for the whole app session — created lazily,
/// connected once the user is authenticated (see `RealtimeConnector`),
/// disposed when the provider scope is torn down (e.g. logout).
final realtimeClientProvider = Provider<RealtimeClient>((ref) {
  final client = SocketIoRealtimeClient();
  ref.onDispose(client.disconnect);
  return client;
});

/// Connects the shared [RealtimeClient] using the current access token.
/// Call once after login/app start; safe to call again (a no-op if already
/// connected) after a token refresh is not needed since the socket keeps
/// its own connection independent of REST token rotation.
Future<void> connectRealtime(WidgetRef ref) async {
  final token = await ref.read(secureStorageProvider).read(StorageKeys.accessToken);
  if (token == null) return;
  ref.read(realtimeClientProvider).connect(token);
}
