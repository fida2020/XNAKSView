import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_config.dart';
import '../core/router/app_router.dart';
import '../core/theme/app_theme.dart';
import '../core/theme/theme_mode_controller.dart';
import '../features/messaging/presentation/call_listener.dart';

class XnakViewApp extends ConsumerWidget {
  const XnakViewApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    // User-selectable Light/Dark/System (see theme_mode_controller.dart) —
    // never forced. The Home video feed itself stays black in every mode
    // (feed_screen.dart hardcodes it, same as TikTok's own always-dark
    // video surface); this only controls chrome screens (Profile, Inbox,
    // Search, Settings, ...).
    final themeMode = ref.watch(themeModeControllerProvider);

    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,
      routerConfig: router,
      builder: (context, child) => CallListener(child: child ?? const SizedBox.shrink()),
    );
  }
}
