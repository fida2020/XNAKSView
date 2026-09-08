import 'package:xnakview/features/messaging/data/realtime_client.dart';

/// An in-memory [RealtimeClient] for tests — [emit] simulates a server
/// broadcast landing on the socket, without a real Socket.IO connection.
/// Also records which LIVE rooms were joined/left, so a test can assert a
/// screen actually joined the room it claims to be watching.
class FakeRealtimeClient implements RealtimeClient {
  final Map<String, List<void Function(dynamic)>> _listeners = {};
  final List<String> joinedLiveSessions = [];
  final List<String> leftLiveSessions = [];
  bool _connected = false;

  @override
  bool get isConnected => _connected;

  @override
  void connect(String accessToken) => _connected = true;

  @override
  void disconnect() {
    _connected = false;
    _listeners.clear();
  }

  @override
  void Function() on(String event, void Function(dynamic payload) callback) {
    final list = _listeners.putIfAbsent(event, () => []);
    list.add(callback);
    return () => list.remove(callback);
  }

  /// Simulates the backend broadcasting [event] with [payload] to every
  /// currently-registered listener — the test-only equivalent of a real
  /// `emitToLiveSession` call landing on the socket.
  void emit(String event, dynamic payload) {
    for (final callback in List.of(_listeners[event] ?? const [])) {
      callback(payload);
    }
  }

  @override
  void joinConversation(String conversationId) {}

  @override
  void leaveConversation(String conversationId) {}

  @override
  void sendTyping(String conversationId) {}

  @override
  void joinLiveSession(String liveSessionId) => joinedLiveSessions.add(liveSessionId);

  @override
  void leaveLiveSession(String liveSessionId) => leftLiveSessions.add(liveSessionId);
}
