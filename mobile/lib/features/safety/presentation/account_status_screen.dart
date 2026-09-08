import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/app_error_widget.dart';
import '../domain/safety_models.dart';
import 'appeal_sheet.dart';
import 'safety_providers.dart';

/// TikTok-style "Account Status" — standing, removed content, restrictions,
/// warnings, and appeal status. Never shows internal fraud scoring,
/// detection-rule internals, or provider names — the backend response has
/// none of that to show (brief §9).
class AccountStatusScreen extends ConsumerWidget {
  const AccountStatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(accountStatusProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Account status')),
      body: RefreshIndicator(
        onRefresh: () => ref.read(accountStatusProvider.notifier).refresh(),
        child: statusAsync.when(
          data: (status) => _buildBody(context, ref, status),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => AppErrorWidget(
            message: error is AppException ? error.message : 'Something went wrong.',
            onRetry: () => ref.read(accountStatusProvider.notifier).refresh(),
          ),
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context, WidgetRef ref, AccountStatusModel status) {
    return ListView(
      children: [
        Container(
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: status.isInGoodStanding ? Colors.green.withValues(alpha: 0.08) : Colors.red.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(status.isInGoodStanding ? Icons.verified_user_outlined : Icons.error_outline, color: status.isInGoodStanding ? Colors.green : Colors.redAccent),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  status.isInGoodStanding ? 'Your account is in good standing.' : _standingMessage(status.accountStanding),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
        if (status.enforcementHistory.isEmpty)
          const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No violations or restrictions on your account.')))
        else
          ...status.enforcementHistory.map((action) => _EnforcementTile(action: action)),
      ],
    );
  }

  String _standingMessage(String standing) {
    switch (standing) {
      case 'BANNED':
        return 'Your account has been permanently banned.';
      case 'SUSPENDED':
        return 'Your account is temporarily restricted.';
      default:
        return 'Your account has restrictions. See details below.';
    }
  }
}

class _EnforcementTile extends ConsumerStatefulWidget {
  const _EnforcementTile({required this.action});
  final EnforcementActionModel action;

  @override
  ConsumerState<_EnforcementTile> createState() => _EnforcementTileState();
}

class _EnforcementTileState extends ConsumerState<_EnforcementTile> {
  Future<void> _appeal() async {
    final submitted = await showAppealSheet(context, enforcementActionId: widget.action.id);
    if (submitted == true) await ref.read(accountStatusProvider.notifier).refresh();
  }

  @override
  Widget build(BuildContext context) {
    final action = widget.action;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(action.title, style: const TextStyle(fontWeight: FontWeight.bold))),
                Chip(label: Text(action.status.name), visualDensity: VisualDensity.compact),
              ],
            ),
            const SizedBox(height: 6),
            Text(action.reason),
            const SizedBox(height: 6),
            Text(_formatDate(action.createdAt), style: const TextStyle(color: Colors.black54, fontSize: 12)),
            if (action.reversedAt != null) ...[
              const SizedBox(height: 6),
              Text('Reversed: ${action.reversalReason ?? "—"}', style: const TextStyle(color: Colors.green, fontSize: 12)),
            ],
            if (action.appeal != null) ...[
              const SizedBox(height: 8),
              Text('Appeal: ${_appealStatusLabel(action.appeal!.status)}', style: const TextStyle(fontStyle: FontStyle.italic)),
            ] else if (action.canAppeal) ...[
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _appeal, child: const Text('Appeal this decision'))),
            ],
          ],
        ),
      ),
    );
  }

  String _appealStatusLabel(AppealStatus status) {
    switch (status) {
      case AppealStatus.submitted:
        return 'Submitted';
      case AppealStatus.underReview:
        return 'Under review';
      case AppealStatus.accepted:
        return 'Accepted';
      case AppealStatus.rejected:
        return 'Rejected';
      case AppealStatus.unknown:
        return 'Unknown';
    }
  }
}

String _formatDate(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}
