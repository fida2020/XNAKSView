import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import '../../../core/router/navigator_key.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';
import 'messaging_providers.dart';

/// Wraps the whole app: connects the realtime gateway once signed in, and
/// pushes [IncomingCallScreen] whenever a `call:incoming` event arrives —
/// this is the "incoming voice call" notification (see
/// docs/STEP5_PROGRESS.md for why this is in-app only, not a background
/// push notification).
class CallListener extends ConsumerWidget {
  const CallListener({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AuthState>(authControllerProvider, (previous, next) {
      final wasAuthenticated = previous?.status == AuthStatus.authenticated;
      final isAuthenticated = next.status == AuthStatus.authenticated;
      if (isAuthenticated && !wasAuthenticated) {
        connectRealtime(ref);
        ref.read(realtimeClientProvider).on('call:incoming', _onIncomingCall);
      } else if (!isAuthenticated && wasAuthenticated) {
        ref.read(realtimeClientProvider).disconnect();
      }
    });

    final authState = ref.read(authControllerProvider);
    if (authState.status == AuthStatus.authenticated && !ref.read(realtimeClientProvider).isConnected) {
      connectRealtime(ref);
      ref.read(realtimeClientProvider).on('call:incoming', _onIncomingCall);
    }

    return child;
  }

  void _onIncomingCall(dynamic payload) {
    final map = Map<String, dynamic>.from(payload as Map);
    final call = Map<String, dynamic>.from(map['call'] as Map);
    final caller = map['caller'] == null ? null : Map<String, dynamic>.from(map['caller'] as Map);
    final navigatorContext = navigatorKey.currentContext;
    if (navigatorContext == null) return;
    navigatorContext.pushIncomingCall(
      callId: call['id'] as String,
      callerName: caller?['displayName'] as String? ?? (caller?['username'] != null ? '@${caller!['username']}' : null),
    );
  }
}
