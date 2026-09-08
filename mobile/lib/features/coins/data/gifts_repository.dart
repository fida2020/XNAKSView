import '../../../core/network/api_client.dart';
import '../domain/gift_models.dart';

/// Gifts — catalog, sending, and sent/received history. `sendGift` is the
/// ONLY place a Gift is sent; the recipient/attribution/Diamond/platform-
/// revenue math all happen server-side (`lib/giftService.ts`) and this
/// repository just relays the result, never computing any of it itself.
class GiftsRepository {
  const GiftsRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<GiftModel>> fetchGifts({String? category}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/gifts',
      queryParameters: {'category': ?category},
    );
    return (response.data!['gifts'] as List).map((item) => GiftModel.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<SendGiftResult> sendGift({
    required String giftSlug,
    required int quantity,
    required GiftTarget target,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/gifts/send',
      data: {
        'giftSlug': giftSlug,
        'quantity': quantity,
        'idempotencyKey': idempotencyKey,
        ...target.toJson(),
      },
    );
    return SendGiftResult.fromJson(response.data!);
  }

  Future<({List<GiftTransactionModel> transactions, String? nextCursor})> fetchSent({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gifts/sent', queryParameters: {'cursor': ?cursor});
    final data = response.data!;
    return (
      transactions: (data['transactions'] as List)
          .map((item) => GiftTransactionModel.sentFromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<({List<GiftTransactionModel> transactions, String? nextCursor})> fetchReceived({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/gifts/received', queryParameters: {'cursor': ?cursor});
    final data = response.data!;
    return (
      transactions: (data['transactions'] as List)
          .map((item) => GiftTransactionModel.receivedFromJson(item as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }
}
