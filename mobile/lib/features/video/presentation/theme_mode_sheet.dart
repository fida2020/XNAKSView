import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/theme_mode_controller.dart';

/// Display (theme) picker — Light / Dark / System, persisted via
/// [ThemeModeController]. Never a fixed/forced theme.
Future<void> showThemeModeSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<void>(
    context: context,
    builder: (context) => const _ThemeModeSheet(),
  );
}

class _ThemeModeSheet extends ConsumerWidget {
  const _ThemeModeSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(themeModeControllerProvider);

    Widget option(ThemeMode mode, IconData icon, String label) {
      return RadioListTile<ThemeMode>(
        value: mode,
        groupValue: current,
        secondary: Icon(icon),
        title: Text(label),
        onChanged: (value) {
          if (value != null) ref.read(themeModeControllerProvider.notifier).setThemeMode(value);
          Navigator.of(context).pop();
        },
      );
    }

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Align(alignment: Alignment.centerLeft, child: Text('Display', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          ),
          option(ThemeMode.light, Icons.light_mode_outlined, 'Light'),
          option(ThemeMode.dark, Icons.dark_mode_outlined, 'Dark'),
          option(ThemeMode.system, Icons.smartphone_outlined, 'System default'),
        ],
      ),
    );
  }
}
