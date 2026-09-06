import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/domain/auth_state.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/register_screen.dart';
import '../../features/auth/presentation/sign_in_screen.dart';
import '../../features/live/presentation/live_discovery_screen.dart';
import '../../features/messaging/presentation/call_history_screen.dart';
import '../../features/messaging/presentation/call_screen.dart';
import '../../features/messaging/presentation/chat_screen.dart';
import '../../features/messaging/presentation/incoming_call_screen.dart';
import '../../features/messaging/presentation/inbox_screen.dart';
import '../../features/profile/presentation/profile_setup_screen.dart';
import '../../features/splash/presentation/splash_screen.dart';
import '../../features/video/presentation/creator_profile_screen.dart';
import '../../features/video/presentation/feed_screen.dart';
import '../../features/video/presentation/upload_video_screen.dart';
import 'navigator_key.dart';

abstract class AppRoutes {
  static const splash = '/splash';
  static const signIn = '/sign-in';
  static const register = '/register';
  static const profileSetup = '/profile-setup';
  static const home = '/home';
  static const uploadVideo = '/upload';
  static const creatorProfile = '/profile';
  static const live = '/live';
  static const inbox = '/inbox';
  static const chat = '/chat';
  static const callHistory = '/calls';
  static const incomingCall = '/incoming-call';
  static const activeCall = '/active-call';
}

extension AppNavigation on BuildContext {
  void pushRegister() => push(AppRoutes.register);
  void pushUploadVideo() => push(AppRoutes.uploadVideo);
  void pushLiveDiscovery() => push(AppRoutes.live);
  void pushInbox() => push(AppRoutes.inbox);
  void pushChat(String conversationId) => push('${AppRoutes.chat}/$conversationId');
  void pushCallHistory() => push(AppRoutes.callHistory);

  void pushActiveCall({
    required String callId,
    required String token,
    required String wsUrl,
    required bool isVideo,
    String? otherUserName,
  }) =>
      push(
        '${AppRoutes.activeCall}/$callId',
        extra: {'token': token, 'wsUrl': wsUrl, 'isVideo': isVideo, 'otherUserName': otherUserName},
      );

  void pushIncomingCall({required String callId, String? callerName, required String callType}) => push(
        '${AppRoutes.incomingCall}/$callId',
        extra: {'callerName': callerName, 'callType': callType},
      );

  /// Omit [userId] to view the signed-in user's own profile.
  void pushCreatorProfile({String? userId}) =>
      push(userId == null ? AppRoutes.creatorProfile : '${AppRoutes.creatorProfile}/$userId');
}

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    navigatorKey: navigatorKey,
    initialLocation: AppRoutes.splash,
    refreshListenable: _AuthStatusListenable(ref),
    redirect: (context, state) {
      final authState = ref.read(authControllerProvider);
      final status = authState.status;
      final isOnSplash = state.matchedLocation == AppRoutes.splash;

      if (status == AuthStatus.unknown) {
        return isOnSplash ? null : AppRoutes.splash;
      }

      final isAuthenticated = status == AuthStatus.authenticated;
      final isOnPublicAuthRoute =
          state.matchedLocation == AppRoutes.signIn || state.matchedLocation == AppRoutes.register;

      if (!isAuthenticated) {
        return isOnPublicAuthRoute ? null : AppRoutes.signIn;
      }

      // Authenticated but hasn't finished profile setup yet.
      if (!authState.hasProfile) {
        return state.matchedLocation == AppRoutes.profileSetup ? null : AppRoutes.profileSetup;
      }

      if (isOnPublicAuthRoute || isOnSplash || state.matchedLocation == AppRoutes.profileSetup) {
        return AppRoutes.home;
      }
      return null;
    },
    routes: [
      GoRoute(path: AppRoutes.splash, builder: (context, state) => const SplashScreen()),
      GoRoute(path: AppRoutes.signIn, builder: (context, state) => const SignInScreen()),
      GoRoute(path: AppRoutes.register, builder: (context, state) => const RegisterScreen()),
      GoRoute(path: AppRoutes.profileSetup, builder: (context, state) => const ProfileSetupScreen()),
      GoRoute(path: AppRoutes.home, builder: (context, state) => const FeedScreen()),
      GoRoute(path: AppRoutes.uploadVideo, builder: (context, state) => const UploadVideoScreen()),
      GoRoute(path: AppRoutes.creatorProfile, builder: (context, state) => const CreatorProfileScreen()),
      GoRoute(
        path: '${AppRoutes.creatorProfile}/:userId',
        builder: (context, state) => CreatorProfileScreen(userId: state.pathParameters['userId']),
      ),
      GoRoute(path: AppRoutes.live, builder: (context, state) => const LiveDiscoveryScreen()),
      GoRoute(path: AppRoutes.inbox, builder: (context, state) => const InboxScreen()),
      GoRoute(
        path: '${AppRoutes.chat}/:conversationId',
        builder: (context, state) => ChatScreen(conversationId: state.pathParameters['conversationId']!),
      ),
      GoRoute(path: AppRoutes.callHistory, builder: (context, state) => const CallHistoryScreen()),
      GoRoute(
        path: '${AppRoutes.incomingCall}/:callId',
        builder: (context, state) => IncomingCallScreen(
          callId: state.pathParameters['callId']!,
          callerName: (state.extra as Map?)?['callerName'] as String?,
          callType: (state.extra as Map?)?['callType'] as String? ?? 'VOICE',
        ),
      ),
      GoRoute(
        path: '${AppRoutes.activeCall}/:callId',
        builder: (context, state) {
          final extra = state.extra as Map;
          return CallScreen(
            callId: state.pathParameters['callId']!,
            token: extra['token'] as String,
            wsUrl: extra['wsUrl'] as String,
            isVideo: extra['isVideo'] as bool,
            otherUserName: extra['otherUserName'] as String?,
          );
        },
      ),
    ],
  );
});

/// Bridges Riverpod state changes into a [Listenable] so GoRouter re-evaluates
/// its redirect callback whenever auth status changes.
class _AuthStatusListenable extends ChangeNotifier {
  _AuthStatusListenable(this.ref) {
    ref.listen(authControllerProvider, (previous, next) {
      if (previous != next) {
        notifyListeners();
      }
    });
  }

  final Ref ref;
}
