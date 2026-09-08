import 'package:flutter/material.dart';

import '../theme/xnak_colors.dart';

/// The one avatar widget every screen should use — consistent sizing and an
/// optional XNAKView-branded gradient ring (used for "LIVE now" / "has an
/// active story" style emphasis, TikTok's functional pattern, XNAKView's own
/// colors) instead of every screen hand-rolling its own `CircleAvatar`.
class XnakAvatar extends StatelessWidget {
  const XnakAvatar({
    super.key,
    this.avatarUrl,
    this.radius = 20,
    this.ringed = false,
    this.fallbackIcon = Icons.person,
  });

  final String? avatarUrl;
  final double radius;
  final bool ringed;
  final IconData fallbackIcon;

  @override
  Widget build(BuildContext context) {
    final avatar = CircleAvatar(
      radius: radius,
      backgroundColor: Colors.black26,
      backgroundImage: avatarUrl != null && avatarUrl!.isNotEmpty ? NetworkImage(avatarUrl!) : null,
      child: avatarUrl == null || avatarUrl!.isEmpty ? Icon(fallbackIcon, size: radius, color: Colors.white70) : null,
    );

    if (!ringed) return avatar;

    return Container(
      padding: EdgeInsets.all(radius * 0.09),
      decoration: const BoxDecoration(gradient: XnakColors.brandGradient, shape: BoxShape.circle),
      child: Container(
        padding: EdgeInsets.all(radius * 0.06),
        decoration: const BoxDecoration(color: Colors.black, shape: BoxShape.circle),
        child: avatar,
      ),
    );
  }
}
