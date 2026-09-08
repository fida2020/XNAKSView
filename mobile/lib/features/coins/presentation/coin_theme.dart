import 'package:flutter/material.dart';

import '../../../core/theme/xnak_colors.dart';

/// XNAKView's own premium visual language for Coins/Gifts/Diamonds —
/// original colors and iconography, deliberately not a copy of any other
/// platform's palette or gift art. Delegates to the app-wide [XnakColors]
/// palette (shared with bottom nav/avatars/badges) rather than defining its
/// own — keeps the whole app on one locked brand identity.
class CoinTheme {
  const CoinTheme._();

  static const Color gold = XnakColors.gold;
  static const Color goldDark = XnakColors.goldDark;
  static const Color magenta = XnakColors.magenta;
  static const Color deepPurple = XnakColors.deepPurple;
  static const Color violet = XnakColors.violet;

  static const LinearGradient coinGradient = XnakColors.goldGradient;

  static const LinearGradient giftPanelGradient = LinearGradient(
    colors: [deepPurple, violet],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );

  static const LinearGradient diamondGradient = LinearGradient(
    colors: [XnakColors.neonCyan, magenta],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
