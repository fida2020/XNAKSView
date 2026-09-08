import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/domain/auth_state.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/oauth_complete_signup_screen.dart';
import '../../features/auth/presentation/oauth_link_screen.dart';
import '../../features/auth/presentation/otp_verify_screen.dart';
import '../../features/auth/presentation/sign_in_screen.dart';
import '../../features/auth/presentation/sign_up_birthday_screen.dart';
import '../../features/auth/presentation/sign_up_credentials_screen.dart';
import '../../features/auth/presentation/sign_up_identifier_screen.dart';
import '../../features/auth/presentation/sign_up_landing_screen.dart';
import '../../features/coins/presentation/coin_wallet_screen.dart';
import '../../features/coins/presentation/creator_earnings_screen.dart';
import '../../features/discovery/presentation/search_screen.dart';
import '../../features/video/presentation/friends_screen.dart';
import '../../features/gamification/presentation/leaderboard_screen.dart';
import '../../features/gamification/presentation/level_screen.dart';
import '../../features/gamification/presentation/my_teams_screen.dart';
import '../../features/live/presentation/live_discovery_screen.dart';
import '../../features/live/presentation/live_viewer_screen.dart';
import '../../features/playlists/presentation/playlist_detail_screen.dart';
import '../../features/playlists/presentation/playlists_screen.dart';
import '../../features/social/presentation/followers_screen.dart';
import '../../features/social/presentation/suggested_accounts_screen.dart';
import '../../features/messaging/presentation/call_history_screen.dart';
import '../../features/messaging/presentation/call_screen.dart';
import '../../features/messaging/presentation/chat_screen.dart';
import '../../features/messaging/presentation/incoming_call_screen.dart';
import '../../features/messaging/presentation/inbox_screen.dart';
import '../../features/profile/presentation/profile_setup_screen.dart';
import '../../features/safety/presentation/account_status_screen.dart';
import '../../features/splash/presentation/splash_screen.dart';
import '../../features/video/presentation/creator_profile_screen.dart';
import '../../features/video/presentation/duet_create_screen.dart';
import '../../features/video/presentation/feed_screen.dart';
import '../../features/video/presentation/single_video_screen.dart';
import '../../features/video/presentation/stitch_create_screen.dart';
import '../../features/video/presentation/create_camera_screen.dart';
import '../navigation/main_shell.dart';
import 'navigator_key.dart';

abstract class AppRoutes {
  static const splash = '/splash';
  static const signIn = '/sign-in';
  static const signUp = '/sign-up';
  static const signUpIdentifier = '/sign-up/identifier';
  static const otpVerify = '/otp-verify';
  static const signUpBirthday = '/sign-up/birthday';
  static const signUpCredentials = '/sign-up/credentials';
  static const oauthLink = '/oauth/link';
  static const oauthCompleteSignup = '/oauth/complete-signup';
  static const profileSetup = '/profile-setup';
  static const home = '/home';
  static const discover = '/discover';
  static const uploadVideo = '/upload';
  static const creatorProfile = '/profile';
  static const live = '/live';
  static const inbox = '/inbox';
  static const chat = '/chat';
  static const callHistory = '/calls';
  static const accountStatus = '/account-status';
  static const incomingCall = '/incoming-call';
  static const activeCall = '/active-call';
  static const search = '/search';
  static const playlists = '/playlists';
  static const followers = '/followers';
  static const suggestedAccounts = '/suggested-accounts';
  static const duetCreate = '/duet';
  static const stitchCreate = '/stitch';
  static const coins = '/coins';
  static const creatorEarnings = '/creator-earnings';
  static const level = '/level';
  static const leaderboards = '/leaderboards';
  static const myTeam = '/team';
  static const video = '/video';
}

extension AppNavigation on BuildContext {
  void pushSignUp() => push(AppRoutes.signUp);
  void pushSignUpIdentifier() => push(AppRoutes.signUpIdentifier);

  void pushOtpVerify({
    String? email,
    String? phone,
    required String purpose,
    required String maskedIdentifier,
    required int resendAvailableInSeconds,
  }) =>
      push(
        AppRoutes.otpVerify,
        extra: {
          'email': email,
          'phone': phone,
          'purpose': purpose,
          'maskedIdentifier': maskedIdentifier,
          'resendAvailableInSeconds': resendAvailableInSeconds,
        },
      );

  void pushSignUpBirthday({String? email, String? phone, required String verificationToken}) => push(
        AppRoutes.signUpBirthday,
        extra: {'email': email, 'phone': phone, 'verificationToken': verificationToken},
      );

  void pushSignUpCredentials({
    String? email,
    String? phone,
    required String verificationToken,
    required DateTime dateOfBirth,
  }) =>
      push(
        AppRoutes.signUpCredentials,
        extra: {'email': email, 'phone': phone, 'verificationToken': verificationToken, 'dateOfBirth': dateOfBirth},
      );

  void pushOAuthLink({required String linkingToken, required String maskedEmail}) =>
      push(AppRoutes.oauthLink, extra: {'linkingToken': linkingToken, 'maskedEmail': maskedEmail});

  void pushOAuthCompleteSignup({
    required String socialSignupToken,
    String? email,
    String? suggestedUsername,
    String? name,
    String? pictureUrl,
  }) =>
      push(
        AppRoutes.oauthCompleteSignup,
        extra: {
          'socialSignupToken': socialSignupToken,
          'email': email,
          'suggestedUsername': suggestedUsername,
          'name': name,
          'pictureUrl': pictureUrl,
        },
      );

  void pushUploadVideo({String? soundId}) => push(AppRoutes.uploadVideo, extra: {'soundId': soundId});
  void pushLiveDiscovery() => push(AppRoutes.live);
  void pushChat(String conversationId) => push('${AppRoutes.chat}/$conversationId');
  void pushCallHistory() => push(AppRoutes.callHistory);
  void pushAccountStatus() => push(AppRoutes.accountStatus);
  void pushSearch() => push(AppRoutes.search);
  void pushPlaylists({String? userId}) => push(AppRoutes.playlists, extra: {'userId': userId});
  void pushPlaylistDetail(String playlistId) => push('${AppRoutes.playlists}/$playlistId');
  void pushFollowers(String userId) => push('${AppRoutes.followers}/$userId');
  void pushSuggestedAccounts() => push(AppRoutes.suggestedAccounts);
  void pushDuetCreate(String sourceVideoId) => push('${AppRoutes.duetCreate}/$sourceVideoId');
  void pushStitchCreate(String sourceVideoId) => push('${AppRoutes.stitchCreate}/$sourceVideoId');
  void pushCoinWallet() => push(AppRoutes.coins);
  void pushCreatorEarnings() => push(AppRoutes.creatorEarnings);
  void pushLevel() => push(AppRoutes.level);
  void pushLeaderboards() => push(AppRoutes.leaderboards);
  void pushMyTeam() => push(AppRoutes.myTeam);

  void pushActiveCall({
    required String callId,
    required String token,
    required String wsUrl,
    String? otherUserName,
  }) =>
      push(
        '${AppRoutes.activeCall}/$callId',
        extra: {'token': token, 'wsUrl': wsUrl, 'otherUserName': otherUserName},
      );

  void pushIncomingCall({required String callId, String? callerName}) => push(
        '${AppRoutes.incomingCall}/$callId',
        extra: {'callerName': callerName},
      );

  /// Viewing another creator's profile is a drill-down (pushed, hides the
  /// bottom nav) — the signed-in user's OWN profile lives in the bottom
  /// nav's Profile tab instead (see [MainShell]), never pushed.
  void pushCreatorProfile(String userId) => push('${AppRoutes.creatorProfile}/$userId');

  /// A shared video link's real destination — reached either by tapping a
  /// share, or by the OS handing XNAKView an `xnakview://video/:id` deep
  /// link directly (see AndroidManifest.xml's intent-filter).
  void pushVideo(String videoId) => push('${AppRoutes.video}/$videoId');
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
      const publicAuthRoutes = {
        AppRoutes.signIn,
        AppRoutes.signUp,
        AppRoutes.signUpIdentifier,
        AppRoutes.otpVerify,
        AppRoutes.signUpBirthday,
        AppRoutes.signUpCredentials,
        AppRoutes.oauthLink,
        AppRoutes.oauthCompleteSignup,
      };
      final isOnPublicAuthRoute = publicAuthRoutes.contains(state.matchedLocation);

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
      GoRoute(path: AppRoutes.signUp, builder: (context, state) => const SignUpLandingScreen()),
      GoRoute(path: AppRoutes.signUpIdentifier, builder: (context, state) => const SignUpIdentifierScreen()),
      GoRoute(
        path: AppRoutes.otpVerify,
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>;
          return OtpVerifyScreen(
            email: extra['email'] as String?,
            phone: extra['phone'] as String?,
            purpose: extra['purpose'] as String,
            maskedIdentifier: extra['maskedIdentifier'] as String,
            resendAvailableInSeconds: extra['resendAvailableInSeconds'] as int,
          );
        },
      ),
      GoRoute(
        path: AppRoutes.signUpBirthday,
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>;
          return SignUpBirthdayScreen(
            email: extra['email'] as String?,
            phone: extra['phone'] as String?,
            verificationToken: extra['verificationToken'] as String,
          );
        },
      ),
      GoRoute(
        path: AppRoutes.signUpCredentials,
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>;
          return SignUpCredentialsScreen(
            email: extra['email'] as String?,
            phone: extra['phone'] as String?,
            verificationToken: extra['verificationToken'] as String,
            dateOfBirth: extra['dateOfBirth'] as DateTime,
          );
        },
      ),
      GoRoute(
        path: AppRoutes.oauthLink,
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>;
          return OAuthLinkScreen(linkingToken: extra['linkingToken'] as String, maskedEmail: extra['maskedEmail'] as String);
        },
      ),
      GoRoute(
        path: AppRoutes.oauthCompleteSignup,
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>;
          return OAuthCompleteSignupScreen(
            socialSignupToken: extra['socialSignupToken'] as String,
            email: extra['email'] as String?,
            suggestedUsername: extra['suggestedUsername'] as String?,
            name: extra['name'] as String?,
            pictureUrl: extra['pictureUrl'] as String?,
          );
        },
      ),
      GoRoute(path: AppRoutes.profileSetup, builder: (context, state) => const ProfileSetupScreen()),

      // TikTok's persistent bottom-nav shell — Home / Friends / (Create,
      // not a branch) / Inbox / Profile. Every branch reuses an existing,
      // already-implemented screen unmodified. The 2nd slot's route path is
      // still `/discover` (AppRoutes.discover) to avoid touching every
      // existing reference to that constant — only the screen it renders
      // (now the real Friends tab: stories + mutual-follow feed) and its
      // bottom-nav label changed. Search remains reachable via the Home top
      // bar's search icon (AppRoutes.search / context.pushSearch()).
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => MainShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: AppRoutes.home, builder: (context, state) => const FeedScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: AppRoutes.discover, builder: (context, state) => const FriendsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: AppRoutes.inbox, builder: (context, state) => const InboxScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: AppRoutes.creatorProfile, builder: (context, state) => const CreatorProfileScreen())]),
        ],
      ),

      // "Use this sound" (a video's sound label) — opens the real Create
      // camera with that sound pre-selected, exactly like tapping the "+"
      // button and picking a sound there; never the old bare upload form.
      GoRoute(
        path: AppRoutes.uploadVideo,
        builder: (context, state) => CreateCameraScreen(initialSoundId: (state.extra as Map?)?['soundId'] as String?),
      ),
      GoRoute(
        path: '${AppRoutes.creatorProfile}/:userId',
        builder: (context, state) => CreatorProfileScreen(userId: state.pathParameters['userId']),
      ),
      GoRoute(
        path: '${AppRoutes.video}/:videoId',
        builder: (context, state) => SingleVideoScreen(videoId: state.pathParameters['videoId']!),
      ),
      GoRoute(path: AppRoutes.live, builder: (context, state) => const LiveDiscoveryScreen()),
      // Real Share deep link for a specific LIVE session —
      // `xnakview://live/:id` (see AndroidManifest.xml's intent-filter).
      GoRoute(
        path: '${AppRoutes.live}/:liveSessionId',
        builder: (context, state) => LiveViewerScreen(liveSessionId: state.pathParameters['liveSessionId']!),
      ),
      GoRoute(
        path: '${AppRoutes.chat}/:conversationId',
        builder: (context, state) => ChatScreen(conversationId: state.pathParameters['conversationId']!),
      ),
      GoRoute(path: AppRoutes.callHistory, builder: (context, state) => const CallHistoryScreen()),
      GoRoute(path: AppRoutes.accountStatus, builder: (context, state) => const AccountStatusScreen()),
      GoRoute(path: AppRoutes.search, builder: (context, state) => const SearchScreen()),
      GoRoute(
        path: AppRoutes.playlists,
        builder: (context, state) => PlaylistsScreen(userId: (state.extra as Map?)?['userId'] as String?),
      ),
      GoRoute(
        path: '${AppRoutes.playlists}/:playlistId',
        builder: (context, state) => PlaylistDetailScreen(playlistId: state.pathParameters['playlistId']!),
      ),
      GoRoute(
        path: '${AppRoutes.followers}/:userId',
        builder: (context, state) => FollowersScreen(userId: state.pathParameters['userId']!),
      ),
      GoRoute(path: AppRoutes.suggestedAccounts, builder: (context, state) => const SuggestedAccountsScreen()),
      GoRoute(path: AppRoutes.coins, builder: (context, state) => const CoinWalletScreen()),
      GoRoute(path: AppRoutes.creatorEarnings, builder: (context, state) => const CreatorEarningsScreen()),
      GoRoute(path: AppRoutes.level, builder: (context, state) => const LevelScreen()),
      GoRoute(path: AppRoutes.leaderboards, builder: (context, state) => const LeaderboardScreen()),
      GoRoute(path: AppRoutes.myTeam, builder: (context, state) => const MyTeamsScreen()),
      GoRoute(
        path: '${AppRoutes.duetCreate}/:sourceVideoId',
        builder: (context, state) => DuetCreateScreen(sourceVideoId: state.pathParameters['sourceVideoId']!),
      ),
      GoRoute(
        path: '${AppRoutes.stitchCreate}/:sourceVideoId',
        builder: (context, state) => StitchCreateScreen(sourceVideoId: state.pathParameters['sourceVideoId']!),
      ),
      GoRoute(
        path: '${AppRoutes.incomingCall}/:callId',
        builder: (context, state) => IncomingCallScreen(
          callId: state.pathParameters['callId']!,
          callerName: (state.extra as Map?)?['callerName'] as String?,
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
