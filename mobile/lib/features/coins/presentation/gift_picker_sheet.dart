import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/widgets/xnak_coin_icon.dart';
import '../domain/gift_models.dart';
import 'buy_coins_screen.dart';
import 'coin_theme.dart';
import 'coins_providers.dart';
import 'gift_visuals.dart';

/// One selectable Gift recipient shown above the Gift grid during a LIVE
/// session (brief §6: "Gifts must visually reflect the actual receiving
/// participant"). This is purely a display/intent aid — the server
/// independently re-validates whichever [id] is actually sent against real
/// LIVE participant state (`lib/giftService.ts`'s `resolveTarget`), and
/// rejects it outright if that participant is no longer active rather than
/// silently redirecting to the host.
class GiftRecipientOption {
  const GiftRecipientOption({required this.id, required this.label, required this.isHost});

  /// Null [id] means "the host" (the server's own default when no
  /// `targetParticipantId` is sent).
  final String? id;
  final String label;
  final bool isHost;
}

/// The Gift picker (brief §3) — shown as a bottom sheet from LIVE or from a
/// video/photo/text post. Gift catalog and pricing come entirely from the
/// backend; quantity and recipient selection are the only client inputs,
/// and both are re-validated server-side on send.
///
/// Returns the [SendGiftResult] on a successful send, or `null` if the
/// sheet was dismissed without sending.
Future<SendGiftResult?> showGiftPickerSheet(
  BuildContext context, {
  required GiftTarget Function(String? targetParticipantId) buildTarget,
  List<GiftRecipientOption> recipients = const [],
}) {
  return showModalBottomSheet<SendGiftResult>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _GiftPickerSheet(buildTarget: buildTarget, recipients: recipients),
  );
}

class _GiftPickerSheet extends ConsumerStatefulWidget {
  const _GiftPickerSheet({required this.buildTarget, required this.recipients});

  final GiftTarget Function(String? targetParticipantId) buildTarget;
  final List<GiftRecipientOption> recipients;

  @override
  ConsumerState<_GiftPickerSheet> createState() => _GiftPickerSheetState();
}

class _GiftPickerSheetState extends ConsumerState<_GiftPickerSheet> {
  List<GiftModel> _gifts = [];
  bool _isLoading = true;
  String? _loadError;

  GiftModel? _selectedGift;
  int _quantity = 1;
  String? _selectedRecipientId;
  bool _isSending = false;

  static const List<int> _quickQuantities = [1, 5, 10, 50];

  @override
  void initState() {
    super.initState();
    if (widget.recipients.isNotEmpty) {
      _selectedRecipientId = widget.recipients.first.id;
    }
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });
    try {
      final gifts = await ref.read(giftsRepositoryProvider).fetchGifts();
      if (mounted) {
        setState(() {
          _gifts = gifts;
          _selectedGift = gifts.isNotEmpty ? gifts.first : null;
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _loadError = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _pickQuantity(int quantity) {
    final maxQuantity = _selectedGift?.maxQuantityPerSend ?? quantity;
    setState(() => _quantity = min(quantity, maxQuantity));
  }

  Future<void> _send() async {
    final gift = _selectedGift;
    if (gift == null || _isSending) return;

    setState(() => _isSending = true);
    try {
      final idempotencyKey = 'gift-${gift.id}-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';
      final result = await ref.read(giftsRepositoryProvider).sendGift(
            giftSlug: gift.slug,
            quantity: _quantity,
            target: widget.buildTarget(_selectedRecipientId),
            idempotencyKey: idempotencyKey,
          );
      ref.read(coinBalanceProvider.notifier).applyKnownBalance(result.senderBalance);
      if (mounted) Navigator.of(context).pop(result);
    } on InsufficientCoinsException {
      if (mounted) _showInsufficientCoins();
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isSending = false);
    }
  }

  void _showInsufficientCoins() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Not enough Coins'),
        content: const Text('You don\'t have enough Coins to send this Gift.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BuyCoinsScreen()));
            },
            child: const Text('Get Coins'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final balanceAsync = ref.watch(coinBalanceProvider);
    final totalCost = (_selectedGift?.coinCost ?? 0) * _quantity;

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            gradient: CoinTheme.giftPanelGradient,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 12),
              Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white38, borderRadius: BorderRadius.circular(2))),
              _buildHeader(balanceAsync),
              if (widget.recipients.isNotEmpty) _buildRecipientRow(),
              const Divider(color: Colors.white24, height: 1),
              Expanded(child: _buildGiftGrid(scrollController)),
              _buildSendBar(balanceAsync, totalCost),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader(AsyncValue<int> balanceAsync) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          const Text('Send a Gift', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
          const Spacer(),
          const XnakCoinIcon(size: 18),
          const SizedBox(width: 4),
          balanceAsync.when(
            data: (balance) => Text('$balance', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            loading: () => const SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
            error: (_, _) => const Text('—', style: TextStyle(color: Colors.white)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BuyCoinsScreen())),
            child: const Text('Get Coins', style: TextStyle(color: CoinTheme.gold)),
          ),
        ],
      ),
    );
  }

  Widget _buildRecipientRow() {
    return SizedBox(
      height: 64,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: widget.recipients.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final recipient = widget.recipients[index];
          final selected = recipient.id == _selectedRecipientId;
          return GestureDetector(
            onTap: () => setState(() => _selectedRecipientId = recipient.id),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: selected ? CoinTheme.magenta : Colors.white24,
                  child: Icon(recipient.isHost ? Icons.star : Icons.person, color: Colors.white, size: 18),
                ),
                const SizedBox(height: 2),
                Text(
                  recipient.label,
                  style: TextStyle(color: selected ? Colors.white : Colors.white70, fontSize: 11),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildGiftGrid(ScrollController scrollController) {
    if (_isLoading) return const Center(child: CircularProgressIndicator(color: Colors.white));
    if (_loadError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_loadError!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_gifts.isEmpty) {
      return const Center(child: Text('No Gifts are available right now.', style: TextStyle(color: Colors.white70)));
    }

    return GridView.builder(
      controller: scrollController,
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        // 0.85 was too tight for GiftTile's real content height — confirmed
        // via a real-device "BOTTOM OVERFLOWED BY 12 PIXELS" render error on
        // every tile. 0.72 gives enough headroom with margin.
        childAspectRatio: 0.72,
      ),
      itemCount: _gifts.length,
      itemBuilder: (context, index) {
        final gift = _gifts[index];
        return GiftTile(
          gift: gift,
          selected: _selectedGift?.id == gift.id,
          onTap: () => setState(() {
            _selectedGift = gift;
            _quantity = min(_quantity, gift.maxQuantityPerSend);
          }),
        );
      },
    );
  }

  Widget _buildSendBar(AsyncValue<int> balanceAsync, int totalCost) {
    final balance = balanceAsync.valueOrNull ?? 0;
    final canAfford = balance >= totalCost;
    final maxQuantity = _selectedGift?.maxQuantityPerSend ?? 1;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Text('Qty', style: TextStyle(color: Colors.white70)),
                const SizedBox(width: 8),
                for (final quantity in _quickQuantities)
                  if (quantity <= maxQuantity) ...[
                    ChoiceChip(
                      label: Text('$quantity'),
                      selected: _quantity == quantity,
                      onSelected: (_) => _pickQuantity(quantity),
                    ),
                    const SizedBox(width: 6),
                  ],
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: canAfford ? CoinTheme.magenta : Colors.grey,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: _selectedGift == null || _isSending ? null : _send,
                child: _isSending
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.card_giftcard, color: Colors.white, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            canAfford ? 'Send for $totalCost Coins' : 'Not enough Coins ($totalCost needed)',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
