import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import 'safety_providers.dart';

/// Submit-an-appeal bottom sheet (brief §10/§16) — the real appeal
/// lifecycle: submit -> automated re-evaluation or human review ->
/// accepted/rejected. Returns `true` via `Navigator.pop` when a real
/// appeal was created so the caller can refresh Account Status.
Future<bool?> showAppealSheet(BuildContext context, {required String enforcementActionId}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => _AppealSheet(enforcementActionId: enforcementActionId),
  );
}

class _AppealSheet extends ConsumerStatefulWidget {
  const _AppealSheet({required this.enforcementActionId});
  final String enforcementActionId;

  @override
  ConsumerState<_AppealSheet> createState() => _AppealSheetState();
}

class _AppealSheetState extends ConsumerState<_AppealSheet> {
  final _reasonController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;
  String? _resultStatus;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_reasonController.text.trim().isEmpty) {
      setState(() => _error = 'Tell us why you think this was a mistake.');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final result = await ref.read(safetyRepositoryProvider).submitAppeal(enforcementActionId: widget.enforcementActionId, reason: _reasonController.text.trim());
      if (mounted) setState(() => _resultStatus = result.status);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: _resultStatus != null ? _buildResult() : _buildForm(),
        ),
      ),
    );
  }

  List<Widget> _buildForm() {
    return [
      const Text('Submit an appeal', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      const SizedBox(height: 4),
      const Text('If you believe this was a mistake, explain why below.', style: TextStyle(color: Colors.black54)),
      const SizedBox(height: 16),
      TextField(
        controller: _reasonController,
        maxLines: 4,
        maxLength: 2000,
        decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Explain what happened...'),
      ),
      if (_error != null) ...[
        const SizedBox(height: 8),
        Text(_error!, style: const TextStyle(color: Colors.redAccent)),
      ],
      const SizedBox(height: 8),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _isSubmitting ? null : _submit,
          child: _isSubmitting ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Submit appeal'),
        ),
      ),
    ];
  }

  List<Widget> _buildResult() {
    final accepted = _resultStatus == 'ACCEPTED';
    return [
      Icon(accepted ? Icons.check_circle : Icons.hourglass_top, color: accepted ? Colors.green : Colors.orange, size: 40),
      const SizedBox(height: 12),
      Text(
        accepted ? 'Your appeal was accepted — your account has been restored.' : 'Your appeal was submitted and is under review. We\'ll notify you of the outcome.',
        style: const TextStyle(fontSize: 15),
      ),
      const SizedBox(height: 16),
      SizedBox(
        width: double.infinity,
        child: FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
      ),
    ];
  }
}
