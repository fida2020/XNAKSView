import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/gamification_models.dart';
import 'gamification_providers.dart';

/// Global leaderboards — Daily/Weekly/Monthly/All-time tabs over a
/// deterministic, server-ranked snapshot (see backend
/// `lib/gamification/leaderboards.ts`). Never shows a suspended/fraud-
/// excluded account — that filtering already happened server-side.
class LeaderboardScreen extends ConsumerStatefulWidget {
  const LeaderboardScreen({super.key, this.initialType = LeaderboardType.giftSenders});

  final LeaderboardType initialType;

  @override
  ConsumerState<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends ConsumerState<LeaderboardScreen> with SingleTickerProviderStateMixin {
  late LeaderboardType _type;
  late final TabController _periodController;

  static const _periods = LeaderboardPeriod.values;

  @override
  void initState() {
    super.initState();
    _type = widget.initialType;
    _periodController = TabController(length: _periods.length, vsync: this, initialIndex: 1);
  }

  @override
  void dispose() {
    _periodController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Leaderboards'),
        bottom: TabBar(controller: _periodController, isScrollable: true, tabs: _periods.map((p) => Tab(text: p.label)).toList()),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: SizedBox(
              height: 36,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: LeaderboardType.values.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final type = LeaderboardType.values[index];
                  final selected = type == _type;
                  return ChoiceChip(
                    label: Text(type.label),
                    selected: selected,
                    onSelected: (_) => setState(() => _type = type),
                    selectedColor: XnakColors.violet,
                    labelStyle: TextStyle(color: selected ? Colors.white : null, fontWeight: FontWeight.w600),
                  );
                },
              ),
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _periodController,
              children: _periods.map((period) => _LeaderboardList(type: _type, period: period)).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _LeaderboardList extends ConsumerWidget {
  const _LeaderboardList({required this.type, required this.period});

  final LeaderboardType type;
  final LeaderboardPeriod period;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.watch(gamificationRepositoryProvider);
    return FutureBuilder(
      future: repository.fetchLeaderboard(type: type, period: period),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          final error = snapshot.error;
          return AppErrorWidget(message: error is AppException ? error.message : 'Failed to load leaderboard');
        }
        final entries = snapshot.data!.entries;
        if (entries.isEmpty) {
          return const Center(child: Text('No ranked activity for this period yet.'));
        }
        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: entries.length,
          itemBuilder: (context, index) => _LeaderboardRow(entry: entries[index]),
        );
      },
    );
  }
}

class _LeaderboardRow extends StatelessWidget {
  const _LeaderboardRow({required this.entry});

  final LeaderboardEntryModel entry;

  @override
  Widget build(BuildContext context) {
    final isTopThree = entry.rank <= 3;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: 32,
            child: Text(
              '#${entry.rank}',
              style: TextStyle(fontWeight: FontWeight.bold, color: isTopThree ? XnakColors.gold : Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ),
          const SizedBox(width: 8),
          // Shows the raw account/team id — resolving it to a display
          // name/avatar per row needs a batch profile lookup this endpoint
          // doesn't do yet (see the Step 11 completion report's limitations).
          Expanded(child: Text('#${entry.subjectId.substring(0, 8)}', overflow: TextOverflow.ellipsis)),
          Text(entry.score, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
