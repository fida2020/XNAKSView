import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/xnak_colors.dart';
import 'feed_controller.dart';
import 'video_page_view.dart';

/// Home — TikTok's defining screen: a full-screen vertical feed with a
/// horizontally scrollable category row at top (LIVE/STEM/Community/Nearby/
/// Following/For You) and a slim search action. Bottom navigation (Friends/
/// Create/Inbox/Profile) lives in `MainShell`; this screen owns only what's
/// specific to Home.
///
/// Only "For You" and "Following" are backed by a real feed today (see
/// `feed_controller.dart`) — LIVE is a real navigation shortcut into the
/// existing LIVE section, never a fake inline stream. STEM/Community/Nearby
/// have no backend endpoint anywhere in this codebase; selecting one shows
/// an honest "not available yet" panel rather than fabricated content.
class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

enum _FeedTab { forYou, following, stem, community, nearby }

class _FeedTabDef {
  const _FeedTabDef(this.tab, this.label);
  final _FeedTab tab;
  final String label;
}

/// LIVE is deliberately NOT in this list — it's a pinned nav shortcut, never
/// part of the horizontally scrollable category row (see `_FeedTopBar`).
const _kScrollableFeedTabs = [
  _FeedTabDef(_FeedTab.stem, 'STEM'),
  _FeedTabDef(_FeedTab.community, 'Community'),
  _FeedTabDef(_FeedTab.nearby, 'Nearby'),
  _FeedTabDef(_FeedTab.following, 'Following'),
  _FeedTabDef(_FeedTab.forYou, 'For You'),
];

class _FeedScreenState extends ConsumerState<FeedScreen> {
  _FeedTab _tab = _FeedTab.forYou;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          Positioned.fill(child: _buildBody()),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: _FeedTopBar(
                selected: _tab,
                onTabSelected: (tab) => setState(() => _tab = tab),
                onLiveTap: () => context.pushLiveDiscovery(),
                onSearchTap: () => context.pushSearch(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    switch (_tab) {
      case _FeedTab.forYou:
        return RefreshIndicator(
          onRefresh: () => ref.read(feedControllerProvider.notifier).loadInitial(),
          child: VideoPageView(
            key: const ValueKey('forYou'),
            controllerProvider: feedControllerProvider,
            emptyMessage: 'No videos yet — be the first to upload!',
          ),
        );
      case _FeedTab.following:
        return RefreshIndicator(
          onRefresh: () => ref.read(followingFeedControllerProvider.notifier).loadInitial(),
          child: VideoPageView(
            key: const ValueKey('following'),
            controllerProvider: followingFeedControllerProvider,
            emptyMessage: 'Follow creators to see their videos here.',
          ),
        );
      case _FeedTab.stem:
        return const _NotAvailableYet(label: 'STEM');
      case _FeedTab.community:
        return const _NotAvailableYet(label: 'Community');
      case _FeedTab.nearby:
        return const _NotAvailableYet(label: 'Nearby');
    }
  }
}

/// Honest placeholder — never fabricated content. Shown only for a category
/// with no backend feed behind it.
class _NotAvailableYet extends StatelessWidget {
  const _NotAvailableYet({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.hourglass_empty, color: Colors.white38, size: 40),
            const SizedBox(height: 16),
            Text(
              '$label is not available yet',
              style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'This section has no content behind it yet on XNAKView.',
              style: TextStyle(color: Colors.white54, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// Structure: [ pinned LIVE ] [ horizontally scrollable categories ] [ pinned Search ].
/// LIVE and Search never move — only the middle `ListView` scrolls
/// (a physically separate widget from the pinned ends, not a visual trick).
class _FeedTopBar extends StatefulWidget {
  const _FeedTopBar({
    required this.selected,
    required this.onTabSelected,
    required this.onLiveTap,
    required this.onSearchTap,
  });

  final _FeedTab selected;
  final ValueChanged<_FeedTab> onTabSelected;
  final VoidCallback onLiveTap;
  final VoidCallback onSearchTap;

  @override
  State<_FeedTopBar> createState() => _FeedTopBarState();
}

class _FeedTopBarState extends State<_FeedTopBar> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // "For You" is the default-selected tab and the last entry in the
    // scrollable row — bring it into view on first build instead of leaving
    // the row scrolled to its leftmost (STEM) position.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          _LiveTabButton(onTap: widget.onLiveTap),
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              itemCount: _kScrollableFeedTabs.length,
              itemBuilder: (context, index) {
                final def = _kScrollableFeedTabs[index];
                final isSelected = def.tab == widget.selected;
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: GestureDetector(
                    onTap: () => widget.onTabSelected(def.tab),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            def.label,
                            style: TextStyle(
                              color: isSelected ? Colors.white : Colors.white70,
                              fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                              fontSize: 15,
                              shadows: const [Shadow(blurRadius: 4, color: Colors.black54)],
                            ),
                          ),
                          const SizedBox(height: 4),
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 150),
                            height: 2,
                            width: isSelected ? 18 : 0,
                            color: XnakColors.magenta,
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          IconButton(
            icon: const Icon(Icons.search, color: Colors.white),
            tooltip: 'Search',
            onPressed: widget.onSearchTap,
          ),
        ],
      ),
    );
  }
}

/// Fixed, never-scrolling LIVE entry — a proper LIVE/TV-style icon with a
/// small live-indicator dot, not just plain text.
class _LiveTabButton extends StatelessWidget {
  const _LiveTabButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 12, right: 6),
      child: GestureDetector(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.live_tv_rounded, color: Colors.white, size: 24, shadows: [Shadow(blurRadius: 4, color: Colors.black54)]),
                Positioned(
                  top: -2,
                  right: -2,
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(color: Colors.redAccent, shape: BoxShape.circle, border: Border.all(color: Colors.black, width: 1)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            const Text('LIVE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 10)),
          ],
        ),
      ),
    );
  }
}
