import 'package:flutter/material.dart';

import '../../../core/widgets/xnak_coin_icon.dart';
import '../domain/gift_models.dart';
import 'coin_theme.dart';

/// Original, programmatic per-category Gift art. The backend's `Gift`
/// model has `thumbnailKey`/`animationAssetKey` fields, but no route
/// resolves them to a fetchable URL yet — there is no upload/asset-serving
/// pipeline for Gift art in this build. Rather than fake an image that
/// can't load, every Gift renders through this original XNAKView visual
/// (icon + gradient, keyed off category), so the picker looks intentional
/// and premium today, and can add real animated art later without any
/// screen depending on that not existing.
class GiftVisual {
  const GiftVisual({required this.icon, required this.gradient});

  final IconData icon;
  final Gradient gradient;

  static GiftVisual forCategory(GiftCategory category) {
    switch (category) {
      case GiftCategory.appreciation:
        return const GiftVisual(
          icon: Icons.favorite,
          gradient: LinearGradient(colors: [Color(0xFFFF7EB3), Color(0xFFFF4D8D)]),
        );
      case GiftCategory.premium:
        return const GiftVisual(
          icon: Icons.diamond,
          gradient: CoinTheme.diamondGradient,
        );
      case GiftCategory.celebration:
        return const GiftVisual(
          icon: Icons.celebration,
          gradient: LinearGradient(colors: [Color(0xFFFFD36E), Color(0xFFFF8A3D)]),
        );
      case GiftCategory.live:
        return const GiftVisual(
          icon: Icons.auto_awesome,
          gradient: LinearGradient(colors: [Color(0xFF7DE8FF), Color(0xFF6C2BD9)]),
        );
      case GiftCategory.special:
        return const GiftVisual(
          icon: Icons.workspace_premium,
          gradient: CoinTheme.coinGradient,
        );
      case GiftCategory.unknown:
        return const GiftVisual(
          icon: Icons.card_giftcard,
          gradient: LinearGradient(colors: [CoinTheme.violet, CoinTheme.magenta]),
        );
    }
  }
}

/// A premium, glossy tile for one catalog Gift — used in the Gift picker
/// grid. Original XNAKView presentation, no borrowed assets.
class GiftTile extends StatelessWidget {
  const GiftTile({super.key, required this.gift, required this.selected, required this.onTap});

  final GiftModel gift;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final visual = GiftVisual.forCategory(gift.category);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          gradient: visual.gradient,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? Colors.white : Colors.transparent, width: 2),
          boxShadow: selected
              ? [BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 12, offset: const Offset(0, 4))]
              : null,
        ),
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(visual.icon, color: Colors.white, size: 32, shadows: const [Shadow(blurRadius: 6, color: Colors.black38)]),
            const SizedBox(height: 6),
            Text(
              gift.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 2),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const XnakCoinIcon(size: 14),
                const SizedBox(width: 2),
                Text('${gift.coinCost}', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
