import 'package:flutter/material.dart';

/// XNAKView's locked brand palette — neon/magenta/purple, originally defined
/// for Coins/Gifts (see `features/coins/presentation/coin_theme.dart`) and
/// promoted here so the rest of the app (bottom nav, avatars, active-state
/// highlights, badges) shares the exact same identity instead of each
/// screen picking its own accent. Never TikTok's palette — same locked
/// hues used throughout.
class XnakColors {
  const XnakColors._();

  static const Color violet = Color(0xFF6C2BD9);
  static const Color deepPurple = Color(0xFF2A0845);
  static const Color magenta = Color(0xFFE930C0);
  static const Color gold = Color(0xFFFFC94A);
  static const Color goldDark = Color(0xFFE0A716);
  static const Color neonCyan = Color(0xFF7DE8FF);

  static const LinearGradient brandGradient = LinearGradient(
    colors: [violet, magenta],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient goldGradient = LinearGradient(
    colors: [gold, goldDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
