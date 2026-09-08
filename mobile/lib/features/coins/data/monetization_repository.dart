import '../../../core/network/api_client.dart';
import '../domain/monetization_models.dart';

/// Creator Monetization (Step 8 — ad revenue) — status/eligibility is
/// entirely server-computed (the backend decides, never this client), and
/// every revenue figure comes straight from the real ad-revenue ledger.
class MonetizationRepository {
  const MonetizationRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<MonetizationStatusModel> fetchStatus() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/creator/monetization/status');
    return MonetizationStatusModel.fromJson(response.data!);
  }

  Future<({List<AdRevenueEventModel> entries, String? nextCursor})> fetchRevenueHistory({String? cursor}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/creator/monetization/revenue',
      queryParameters: {'cursor': ?cursor},
    );
    final data = response.data!;
    return (
      entries: (data['history'] as List).map((item) => AdRevenueEventModel.fromJson(item as Map<String, dynamic>)).toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }
}
