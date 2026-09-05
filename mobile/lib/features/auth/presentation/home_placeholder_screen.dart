import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import 'auth_controller.dart';

/// Placeholder authenticated-app landing screen. Real feed/home UI arrives
/// in Phase 3 (Video Feed) — this exists so routing has a concrete
/// authenticated destination to land on.
class HomePlaceholderScreen extends ConsumerWidget {
  const HomePlaceholderScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(AppConfig.appName),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
      body: const Center(child: Text('Home feed (coming in Phase 3)')),
    );
  }
}
