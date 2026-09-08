import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/video/presentation/create_camera_screen.dart';
import '../theme/xnak_colors.dart';

/// TikTok's defining navigation pattern: a persistent bottom bar with five
/// slots — Home, Friends, a raised center Create button, Inbox, Profile —
/// wrapping four independently-navigable tab stacks (via go_router's
/// `StatefulShellRoute`) plus one action button that isn't a tab at all.
/// Every existing screen used as a tab body is reused unmodified; this is
/// purely the navigation shell around them.
class MainShell extends StatelessWidget {
  const MainShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  static const _tabs = [
    (icon: Icons.home_rounded, outlinedIcon: Icons.home_outlined, label: 'Home'),
    (icon: Icons.people_alt_rounded, outlinedIcon: Icons.people_alt_outlined, label: 'Friends'),
    null, // center Create button — not a tab branch
    (icon: Icons.mail_rounded, outlinedIcon: Icons.mail_outline, label: 'Inbox'),
    (icon: Icons.person, outlinedIcon: Icons.person_outline, label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: navigationShell,
      bottomNavigationBar: _XnakBottomNav(
        currentIndex: navigationShell.currentIndex,
        onTabSelected: (branchIndex) => navigationShell.goBranch(branchIndex, initialLocation: branchIndex == navigationShell.currentIndex),
      ),
    );
  }
}

class _XnakBottomNav extends StatelessWidget {
  const _XnakBottomNav({required this.currentIndex, required this.onTabSelected});

  final int currentIndex;
  final void Function(int branchIndex) onTabSelected;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final background = isDark ? Colors.black : Colors.white;

    return Container(
      decoration: BoxDecoration(
        color: background,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 8, offset: const Offset(0, -2))],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 52,
          child: Row(
            children: [
              _navItem(context, slotIndex: 0, branchIndex: 0),
              _navItem(context, slotIndex: 1, branchIndex: 1),
              Expanded(
                child: Center(
                  child: GestureDetector(
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateCameraScreen())),
                    child: Container(
                      width: 46,
                      height: 32,
                      decoration: BoxDecoration(
                        gradient: XnakColors.brandGradient,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.add, color: Colors.white, size: 26),
                    ),
                  ),
                ),
              ),
              _navItem(context, slotIndex: 3, branchIndex: 2),
              _navItem(context, slotIndex: 4, branchIndex: 3),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(BuildContext context, {required int slotIndex, required int branchIndex}) {
    final tab = MainShell._tabs[slotIndex]!;
    final selected = currentIndex == branchIndex;
    final color = selected ? (Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black) : Colors.grey;

    return Expanded(
      child: InkWell(
        onTap: () => onTabSelected(branchIndex),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(selected ? tab.icon : tab.outlinedIcon, color: color, size: 24),
            const SizedBox(height: 2),
            Text(tab.label, style: TextStyle(color: color, fontSize: 10, fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}
