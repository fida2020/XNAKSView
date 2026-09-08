import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../../core/widgets/xnak_avatar.dart';
import '../../social/presentation/social_providers.dart';
import '../domain/live_guest_model.dart';
import 'live_providers.dart';

/// Host-side co-host/multi-guest management (TikTok's LIVE "guests" panel)
/// — reuses the existing invite/remove backend endpoints (Step 4) and the
/// existing followers list (Step 6) unchanged; this is the first mobile UI
/// either has ever had. Inviting from followers is the honest scope here —
/// there's no realtime/"pending invites" mechanism yet for the invited
/// user to discover the invite on their own device (a real, disclosed gap;
/// see the Step 7 UI report), so this sheet only covers what the host can
/// actually do: invite, watch the slot list, and remove an active guest.
Future<void> showGuestManagementSheet(BuildContext context, String liveSessionId, String hostUserId) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _GuestManagementSheet(liveSessionId: liveSessionId, hostUserId: hostUserId),
  );
}

class _GuestManagementSheet extends ConsumerStatefulWidget {
  const _GuestManagementSheet({required this.liveSessionId, required this.hostUserId});

  final String liveSessionId;
  final String hostUserId;

  @override
  ConsumerState<_GuestManagementSheet> createState() => _GuestManagementSheetState();
}

class _GuestManagementSheetState extends ConsumerState<_GuestManagementSheet> {
  List<LiveGuestModel> _guests = [];
  int _maxGuestSlots = 1;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final result = await ref.read(liveRepositoryProvider).fetchGuests(widget.liveSessionId);
      if (mounted) {
        setState(() {
          _guests = result.guests;
          _maxGuestSlots = result.maxGuestSlots;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _remove(LiveGuestModel guest) async {
    try {
      await ref.read(liveRepositoryProvider).removeGuest(widget.liveSessionId, guest.userId);
      _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _openInvitePicker() async {
    final activeCount = _guests.where((g) => g.status == LiveGuestStatus.active).length;
    if (activeCount >= _maxGuestSlots) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('All guest slots are full.')));
      return;
    }
    final selected = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => _FollowerPicker(hostUserId: widget.hostUserId),
    );
    if (selected == null) return;
    try {
      await ref.read(liveRepositoryProvider).inviteGuest(widget.liveSessionId, userId: selected);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invite sent.')));
      _load();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        return SafeArea(
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('Guests', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ),
              const Divider(height: 1),
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator())
                    : _error != null
                        ? Center(child: Text(_error!))
                        : ListView(
                            controller: scrollController,
                            children: [
                              for (final guest in _guests)
                                ListTile(
                                  leading: XnakAvatar(avatarUrl: guest.user?.avatarUrl, radius: 20),
                                  title: Text(guest.displayLabel),
                                  subtitle: Text('${guest.role == LiveGuestRole.coHost ? 'Co-host' : 'Guest'} · ${guest.status.name}'),
                                  trailing: guest.status == LiveGuestStatus.active
                                      ? IconButton(icon: const Icon(Icons.person_remove_outlined), onPressed: () => _remove(guest))
                                      : null,
                                ),
                              if (_guests.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No guests yet.'))),
                            ],
                          ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: XnakColors.violet),
                    onPressed: _openInvitePicker,
                    icon: const Icon(Icons.person_add_alt_1),
                    label: const Text('Invite a follower'),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _FollowerPicker extends ConsumerWidget {
  const _FollowerPicker({required this.hostUserId});

  final String hostUserId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: FutureBuilder(
        future: ref.read(socialRepositoryProvider).fetchFollowers(hostUserId),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
          }
          final followers = snapshot.data!;
          if (followers.isEmpty) {
            return const SizedBox(height: 120, child: Center(child: Text('No followers to invite yet.')));
          }
          return ListView(
            shrinkWrap: true,
            children: [
              for (final follower in followers)
                ListTile(
                  leading: XnakAvatar(avatarUrl: follower.avatarUrl, radius: 20),
                  title: Text(follower.displayLabel),
                  onTap: () => Navigator.of(context).pop(follower.id),
                ),
            ],
          );
        },
      ),
    );
  }
}
