import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../../../core/config/app_config.dart';

/// Abstraction over the realtime transport matching the backend's realtime
/// gateway (`backend/src/lib/realtime.ts`). Feature repositories/screens
/// depend on this interface, not on `socket_io_client` directly — same
/// seam as `ApiClient`/`SecureStorage` — so the transport can be faked in
/// tests or swapped later without touching screen code.
///
/// Messages/calls/Gifts are never *sent* over this socket — it only
/// notifies of state the REST API already persisted. A screen reconciles
/// incoming events against what it already has by id, so a duplicate or
/// out-of-order event is harmless to apply twice.
abstract class RealtimeClient {
  bool get isConnected;

  void connect(String accessToken);

  void disconnect();

  /// Registers a listener for [event]; call the returned function to remove
  /// just this listener (screens should do this in `dispose()`).
  void Function() on(String event, void Function(dynamic payload) callback);

  void joinConversation(String conversationId);

  void leaveConversation(String conversationId);

  void sendTyping(String conversationId);

  /// Joins a LIVE session's realtime room (`live:{id}` on the backend) —
  /// this is how the Gift feature (Step 7) receives `gift:sent` broadcasts
  /// without polling. Same shared socket as chat/calls, never a second
  /// connection.
  void joinLiveSession(String liveSessionId);

  void leaveLiveSession(String liveSessionId);
}

class SocketIoRealtimeClient implements RealtimeClient {
  socket_io.Socket? _socket;
  final Map<String, List<void Function(dynamic)>> _listeners = {};

  @override
  bool get isConnected => _socket?.connected ?? false;

  @override
  void connect(String accessToken) {
    if (_socket != null) return;

    final apiOrigin = Uri.parse(AppConfig.apiBaseUrl);
    final origin = Uri(scheme: apiOrigin.scheme, host: apiOrigin.host, port: apiOrigin.port).toString();

    final socket = socket_io.io(
      origin,
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .disableAutoConnect()
          .build(),
    );
    _socket = socket;
    socket.connect();
  }

  @override
  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _listeners.clear();
  }

  @override
  void Function() on(String event, void Function(dynamic payload) callback) {
    _socket?.on(event, callback);
    _listeners.putIfAbsent(event, () => []).add(callback);
    return () => _socket?.off(event, callback);
  }

  @override
  void joinConversation(String conversationId) => _socket?.emit('conversation:join', conversationId);

  @override
  void leaveConversation(String conversationId) => _socket?.emit('conversation:leave', conversationId);

  @override
  void sendTyping(String conversationId) => _socket?.emit('conversation:typing', {'conversationId': conversationId});

  @override
  void joinLiveSession(String liveSessionId) => _socket?.emit('live:join', liveSessionId);

  @override
  void leaveLiveSession(String liveSessionId) => _socket?.emit('live:leave', liveSessionId);
}
