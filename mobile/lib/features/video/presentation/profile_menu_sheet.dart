import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import '../../../core/widgets/xnak_coin_icon.dart';
import '../../auth/presentation/auth_controller.dart';
import 'theme_mode_sheet.dart';

/// The profile's ☰ menu — TikTok's real information architecture (Balance
/// under a dedicated section, Creator tools separate from personal tools,
/// Settings last), organized around XNAKView's *existing* features. Every
/// entry pushes an already-implemented screen; nothing here is invented,
/// and a section with no real screen behind it yet (full account/privacy/
/// security settings) is disclosed as "coming soon" rather than faked.
Future<void> showProfileMenu(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => const _ProfileMenuSheet(),
  );
}

class _ProfileMenuSheet extends ConsumerWidget {
  const _ProfileMenuSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 36, height: 4, decoration: BoxDecoration(color: Colors.grey.shade400, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 8),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  const _MenuSectionLabel('Assets'),
                  _MenuTile(leading: const XnakCoinIcon(size: 24), label: 'Coins & Balance', onTap: () {
                    Navigator.of(context).pop();
                    context.pushCoinWallet();
                  }),
                  const Divider(height: 24),
                  const _MenuSectionLabel('Personal'),
                  _MenuTile(icon: Icons.playlist_play, label: 'Playlists', onTap: () {
                    Navigator.of(context).pop();
                    context.pushPlaylists();
                  }),
                  _MenuTile(icon: Icons.person_search, label: 'Discover people', onTap: () {
                    Navigator.of(context).pop();
                    context.pushSuggestedAccounts();
                  }),
                  _MenuTile(icon: Icons.call_outlined, label: 'Call history', onTap: () {
                    Navigator.of(context).pop();
                    context.pushCallHistory();
                  }),
                  const Divider(height: 24),
                  const _MenuSectionLabel('Creator tools'),
                  _MenuTile(icon: Icons.diamond_outlined, label: 'XNAKView Studio', onTap: () {
                    Navigator.of(context).pop();
                    context.pushCreatorEarnings();
                  }),
                  _MenuTile(icon: Icons.live_tv_outlined, label: 'Go LIVE', onTap: () {
                    Navigator.of(context).pop();
                    context.pushLiveDiscovery();
                  }),
                  const Divider(height: 24),
                  const _MenuSectionLabel('Progress & Teams'),
                  _MenuTile(icon: Icons.military_tech_outlined, label: 'Level, Badges & Achievements', onTap: () {
                    Navigator.of(context).pop();
                    context.pushLevel();
                  }),
                  _MenuTile(icon: Icons.groups_outlined, label: 'My Team', onTap: () {
                    Navigator.of(context).pop();
                    context.pushMyTeam();
                  }),
                  _MenuTile(icon: Icons.leaderboard_outlined, label: 'Leaderboards', onTap: () {
                    Navigator.of(context).pop();
                    context.pushLeaderboards();
                  }),
                  const Divider(height: 24),
                  const _MenuSectionLabel('Settings and privacy'),
                  _MenuTile(icon: Icons.shield_outlined, label: 'Account status', onTap: () {
                    Navigator.of(context).pop();
                    context.pushAccountStatus();
                  }),
                  _MenuTile(icon: Icons.dark_mode_outlined, label: 'Display (theme)', onTap: () {
                    Navigator.of(context).pop();
                    showThemeModeSheet(context, ref);
                  }),
                  ListTile(
                    leading: const Icon(Icons.info_outline, color: Colors.grey),
                    title: const Text('Account, privacy & security settings', style: TextStyle(color: Colors.grey)),
                    subtitle: const Text('Coming soon', style: TextStyle(fontSize: 11)),
                    enabled: false,
                  ),
                  _MenuTile(
                    icon: Icons.logout,
                    label: 'Sign out',
                    destructive: true,
                    onTap: () {
                      Navigator.of(context).pop();
                      ref.read(authControllerProvider.notifier).signOut();
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuSectionLabel extends StatelessWidget {
  const _MenuSectionLabel(this.label);
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({this.icon, this.leading, required this.label, required this.onTap, this.destructive = false})
      : assert(icon != null || leading != null, 'Provide either icon or leading');

  final IconData? icon;

  /// Overrides [icon] — used for the real XNAKView Coin artwork instead of
  /// a generic Material icon (see [XnakCoinIcon]).
  final Widget? leading;
  final String label;
  final VoidCallback onTap;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? Colors.redAccent : null;
    return ListTile(
      leading: leading ?? Icon(icon, color: color),
      title: Text(label, style: TextStyle(color: color)),
      onTap: onTap,
    );
  }
}
