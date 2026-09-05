import 'package:flutter/material.dart';

/// XNAKView brand theme placeholder.
///
/// Colors/typography are provisional and expected to be replaced once brand
/// guidelines are finalized — the goal at this stage is a consistent,
/// centralized theme rather than a final visual identity.
class AppTheme {
  const AppTheme._();

  static const Color _seedColor = Color(0xFF6C2BD9);

  static ThemeData get light => ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        colorScheme: ColorScheme.fromSeed(
          seedColor: _seedColor,
          brightness: Brightness.light,
        ),
        appBarTheme: const AppBarTheme(centerTitle: true, elevation: 0),
      );

  static ThemeData get dark => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: _seedColor,
          brightness: Brightness.dark,
        ),
        appBarTheme: const AppBarTheme(centerTitle: true, elevation: 0),
      );
}
