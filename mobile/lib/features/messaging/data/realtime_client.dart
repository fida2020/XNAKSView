import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../../../core/config/app_config.dart';

/// Thin wrapper around the Socket.IO client matching the backend's realtime
/// gateway (`backend/src/lib/realtime.ts`) — a real WebSocket connection,
/// not polling. Feature code depends on this class's typed event streams,
/// not on `socket_io_client` directly, so the transport could be swapped
/// without touching screens.
///
/// Messages/calls are never *sent* over this socket — it only notifies of
/// state the REST API (`MessagingRepository`) already persisted. A screen
/// reconciles incoming events against what it already has by id, so a
/// duplicate or out-of-order event is harmless to apply twice.
class RealtimeClient {
  socket_io.Socket? _socket;
  final Map<String, List<void Function(dynamic)>> _listeners = {};

  bool get isConnected => _socket?.connected ?? false;

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

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _listeners.clear();
  }

  /// Registers a listener for [event]; call the returned function to remove
  /// just this listener (screens should do this in `dispose()`).
  void Function() on(String event, void Function(dynamic payload) callback) {
    _socket?.on(event, callback);
    _listeners.putIfAbsent(event, () => []).add(callback);
    return () => _socket?.off(event, callback);
  }

  void joinConversation(String conversationId) => _socket?.emit('conversation:join', conversationId);

  void leaveConversation(String conversationId) => _socket?.emit('conversation:leave', conversationId);

  void sendTyping(String conversationId) => _socket?.emit('conversation:typing', {'conversationId': conversationId});
}
