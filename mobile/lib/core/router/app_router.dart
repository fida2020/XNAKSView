import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/domain/auth_state.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/home_placeholder_screen.dart';
import '../../features/auth/presentation/register_screen.dart';
import '../../features/auth/presentation/sign_in_screen.dart';
import '../../features/profile/presentation/profile_setup_screen.dart';
import '../../features/splash/presentation/splash_screen.dart';

abstract class AppRoutes {
  static const splash = '/splash';
  static const signIn = '/sign-in';
  static const register = '/register';
  static const profileSetup = '/profile-setup';
  static const home = '/home';
}

extension AppNavigation on BuildContext {
  void pushRegister() => push(AppRoutes.register);
}

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
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
      GoRoute(path: AppRoutes.home, builder: (context, state) => const HomePlaceholderScreen()),
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
