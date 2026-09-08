import '../../../core/network/api_client.dart';
import '../domain/safety_models.dart';

/// Step 10 Trust & Safety — Account Status, reporting, and appeals. Never
/// exposes/requests internal fraud-scoring or moderation-provider details;
/// the backend doesn't return them (see `routes/v1/accountStatus.ts`).
class SafetyRepository {
  const SafetyRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<AccountStatusModel> fetchAccountStatus() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/account/status');
    return AccountStatusModel.fromJson(response.data!);
  }

  Future<({String id, String status})> submitAppeal({required String enforcementActionId, required String reason}) async {
    final response = await _apiClient.post<Map<String, dynamic>>('/enforcement-actions/$enforcementActionId/appeal', data: {'reason': reason});
    final data = response.data!;
    return (id: data['id'] as String, status: data['status'] as String);
  }

  Future<({String id, String status})> fetchAppeal(String appealId) async {
    final response = await _apiClient.get<Map<String, dynamic>>('/appeals/$appealId');
    final data = response.data!;
    return (id: data['id'] as String, status: data['status'] as String);
  }

  Future<String> submitReport({
    required ReportTargetType targetType,
    required String targetId,
    String? targetUserId,
    required ReportReason reason,
    String? details,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/safety/reports',
      data: {
        'targetType': targetType.apiValue,
        'targetId': targetId,
        if (targetUserId != null) 'targetUserId': targetUserId,
        'reasonCategory': reason.apiValue,
        if (details != null && details.isNotEmpty) 'details': details,
      },
    );
    return response.data!['id'] as String;
  }
}
