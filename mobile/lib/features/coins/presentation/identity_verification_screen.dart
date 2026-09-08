import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/creator_economy_models.dart';
import 'coins_providers.dart';
import 'creator_economy_providers.dart';

/// Step 2 of the withdrawal flow — "Verification". Real KYC, driven by
/// whichever provider is configured for the creator's country (see
/// `lib/payout/identityVerificationProvider.ts`) — never a fake instant
/// pass. Approval/rejection always arrives asynchronously via the
/// provider's webhook, so this screen polls rather than assuming a result.
class IdentityVerificationScreen extends ConsumerStatefulWidget {
  const IdentityVerificationScreen({required this.country, super.key});

  final String country;

  @override
  ConsumerState<IdentityVerificationScreen> createState() => _IdentityVerificationScreenState();
}

class _IdentityVerificationScreenState extends ConsumerState<IdentityVerificationScreen> {
  bool _isStarting = false;
  String? _error;

  Future<void> _refresh() => ref.read(identityVerificationProvider.notifier).refresh();

  Future<void> _start() async {
    setState(() {
      _isStarting = true;
      _error = null;
    });
    try {
      await ref.read(creatorEconomyRepositoryProvider).startIdentityVerification(country: widget.country);
      await _refresh();
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final verificationAsync = ref.watch(identityVerificationProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Verify your identity')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: verificationAsync.when(
          data: (verification) => _buildBody(verification),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(24),
            children: [Text(error is AppException ? error.message : 'Something went wrong.', textAlign: TextAlign.center)],
          ),
        ),
      ),
    );
  }

  Widget _buildBody(IdentityVerificationModel? verification) {
    if (verification == null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            'Identity verification is required before you can withdraw. This confirms you\'re the account holder receiving payouts.',
          ),
          const SizedBox(height: 20),
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            const SizedBox(height: 12),
          ],
          FilledButton(
            onPressed: _isStarting ? null : _start,
            child: _isStarting
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Start verification'),
          ),
        ],
      );
    }

    switch (verification.status) {
      case IdentityVerificationStatus.approved:
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 48),
            const SizedBox(height: 12),
            const Text('Your identity is verified.', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),
            FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Continue')),
          ],
        );
      case IdentityVerificationStatus.rejected:
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
            const SizedBox(height: 12),
            Text(verification.rejectionReason ?? 'Verification was rejected.', textAlign: TextAlign.center),
            const SizedBox(height: 20),
            FilledButton(onPressed: _isStarting ? null : _start, child: const Text('Try again')),
          ],
        );
      case IdentityVerificationStatus.pending:
      case IdentityVerificationStatus.expired:
      case IdentityVerificationStatus.unknown:
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Center(child: CircularProgressIndicator()),
            const SizedBox(height: 16),
            const Text('Verification in progress. This is confirmed by the provider — pull to refresh once complete.', textAlign: TextAlign.center),
            if (verification.hostedUrl != null) ...[
              const SizedBox(height: 16),
              SelectableText(verification.hostedUrl!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.blue)),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: verification.hostedUrl!));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied')));
                },
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copy verification link'),
              ),
            ],
          ],
        );
    }
  }
}
