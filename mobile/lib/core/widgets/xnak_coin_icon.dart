import 'package:flutter/material.dart';

/// The real XNAKView Coin artwork (provided asset, never a generic Material
/// icon or a redrawn substitute) — used everywhere a Coin needs
/// representing: wallet balance, package cards, Gift cost, Gift tiles.
class XnakCoinIcon extends StatelessWidget {
  const XnakCoinIcon({super.key, this.size = 20});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset('assets/branding/xnakview_coin.png', width: size, height: size, fit: BoxFit.contain);
  }
}
