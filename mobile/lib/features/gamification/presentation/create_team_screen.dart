import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import 'gamification_providers.dart';
import 'team_home_screen.dart';

/// Creates a new LIVE Team — the caller becomes OWNER immediately (see
/// backend `createTeam`). A user already in an active team is rejected by
/// the backend (one active membership at a time); the error message is
/// shown as-is rather than duplicating that rule client-side.
class CreateTeamScreen extends ConsumerStatefulWidget {
  const CreateTeamScreen({super.key});

  @override
  ConsumerState<CreateTeamScreen> createState() => _CreateTeamScreenState();
}

class _CreateTeamScreenState extends ConsumerState<CreateTeamScreen> {
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (_nameController.text.trim().length < 2) {
      setState(() => _error = 'Team name must be at least 2 characters');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final team = await ref.read(teamsRepositoryProvider).createTeam(
            name: _nameController.text.trim(),
            description: _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
          );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => TeamHomeScreen(teamId: team.id)));
    } on AppException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create a Team')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Team name', border: OutlineInputBorder())),
          const SizedBox(height: 16),
          TextField(
            controller: _descriptionController,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Description (optional)', border: OutlineInputBorder()),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _create,
            child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Create Team'),
          ),
        ],
      ),
    );
  }
}
