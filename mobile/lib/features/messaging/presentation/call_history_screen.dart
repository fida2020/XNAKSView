import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/call_model.dart';
import 'messaging_providers.dart';

class CallHistoryScreen extends ConsumerStatefulWidget {
  const CallHistoryScreen({super.key});

  @override
  ConsumerState<CallHistoryScreen> createState() => _CallHistoryScreenState();
}

class _CallHistoryScreenState extends ConsumerState<CallHistoryScreen> {
  List<CallModel> _calls = [];
  String? _nextCursor;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await ref.read(messagingRepositoryProvider).listCallHistory();
      if (!mounted) return;
      setState(() {
        _calls = page.calls;
        _nextCursor = page.nextCursor;
        _isLoading = false;
      });
    } on AppException catch (error) {
      if (mounted) setState(() { _isLoading = false; _error = error.message; });
    }
  }

  Future<void> _loadMore() async {
    if (_nextCursor == null) return;
    final page = await ref.read(messagingRepositoryProvider).listCallHistory(cursor: _nextCursor);
    if (!mounted) return;
    setState(() {
      _calls = [..._calls, ...page.calls];
      _nextCursor = page.nextCursor;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Call history')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : _calls.isEmpty
                  ? const Center(child: Text('No calls yet.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        itemCount: _calls.length + (_nextCursor != null ? 1 : 0),
                        itemBuilder: (context, index) {
                          if (index == _calls.length) {
                            _loadMore();
                            return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
                          }
                          return _CallHistoryTile(call: _calls[index]);
                        },
                      ),
                    ),
    );
  }
}

class _CallHistoryTile extends StatelessWidget {
  const _CallHistoryTile({required this.call});

  final CallModel call;

  IconData get _directionIcon {
    switch (call.status) {
      case CallStatus.missed:
        return Icons.call_missed;
      case CallStatus.declined:
        return Icons.call_missed_outgoing;
      default:
        return call.direction == CallDirection.incoming ? Icons.call_received : Icons.call_made;
    }
  }

  Color? _directionColor(BuildContext context) {
    if (call.status == CallStatus.missed || call.status == CallStatus.declined) return Theme.of(context).colorScheme.error;
    return null;
  }

  String get _subtitle {
    final duration = call.durationSeconds;
    switch (call.status) {
      case CallStatus.missed:
        return 'Missed';
      case CallStatus.declined:
        return 'Declined';
      case CallStatus.busy:
        return 'Busy';
      case CallStatus.cancelled:
        return 'Cancelled';
      case CallStatus.failed:
        return 'Failed${call.failureReason != null ? ': ${call.failureReason}' : ''}';
      default:
        return duration != null ? '${duration ~/ 60}:${(duration % 60).toString().padLeft(2, '0')}' : call.status.name;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(
        backgroundImage: call.otherUser?.avatarUrl != null ? NetworkImage(call.otherUser!.avatarUrl!) : null,
        child: call.otherUser?.avatarUrl == null ? const Icon(Icons.person) : null,
      ),
      title: Text(call.otherUser?.displayLabel ?? 'Unknown'),
      subtitle: Row(
        children: [
          Icon(_directionIcon, size: 16, color: _directionColor(context)),
          const SizedBox(width: 4),
          Text(_subtitle),
        ],
      ),
      trailing: const Icon(Icons.call_outlined),
    );
  }
}
