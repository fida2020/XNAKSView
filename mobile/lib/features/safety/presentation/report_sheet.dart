import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/safety_models.dart';
import 'safety_providers.dart';

/// TikTok-style report sheet — pick a reason, optional details, submit.
/// Works for any reportable target via `ReportTargetType` (brief §8/§16).
/// Returns `true` when a report was actually created.
Future<bool?> showReportSheet(
  BuildContext context, {
  required ReportTargetType targetType,
  required String targetId,
  String? targetUserId,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => _ReportSheet(targetType: targetType, targetId: targetId, targetUserId: targetUserId),
  );
}

class _ReportSheet extends ConsumerStatefulWidget {
  const _ReportSheet({required this.targetType, required this.targetId, this.targetUserId});

  final ReportTargetType targetType;
  final String targetId;
  final String? targetUserId;

  @override
  ConsumerState<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<_ReportSheet> {
  ReportReason? _selectedReason;
  final _detailsController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;
  bool _submitted = false;

  @override
  void dispose() {
    _detailsController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedReason == null) {
      setState(() => _error = 'Choose a reason for this report.');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await ref.read(safetyRepositoryProvider).submitReport(
            targetType: widget.targetType,
            targetId: widget.targetId,
            targetUserId: widget.targetUserId,
            reason: _selectedReason!,
            details: _detailsController.text.trim(),
          );
      if (mounted) setState(() => _submitted = true);
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
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: _submitted ? _buildConfirmation() : _buildForm(),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildForm() {
    return [
      const Text('Report', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      const SizedBox(height: 12),
      ...ReportReason.values.map(
        (reason) => RadioListTile<ReportReason>(
          value: reason,
          groupValue: _selectedReason,
          title: Text(reason.label),
          contentPadding: EdgeInsets.zero,
          onChanged: (value) => setState(() => _selectedReason = value),
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _detailsController,
        maxLines: 3,
        maxLength: 1000,
        decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Add details (optional)'),
      ),
      if (_error != null) ...[
        const SizedBox(height: 8),
        Text(_error!, style: const TextStyle(color: Colors.redAccent)),
      ],
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _isSubmitting ? null : _submit,
          child: _isSubmitting ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Submit report'),
        ),
      ),
    ];
  }

  List<Widget> _buildConfirmation() {
    return [
      const Icon(Icons.check_circle, color: Colors.green, size: 40),
      const SizedBox(height: 12),
      const Text('Thanks for reporting. Our safety systems will review this.', style: TextStyle(fontSize: 15)),
      const SizedBox(height: 16),
      SizedBox(
        width: double.infinity,
        child: FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
      ),
    ];
  }
}
