import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../errors/app_exception.dart';
import '../storage/secure_storage.dart';

/// Thin abstraction over the HTTP client used to talk to the XNAKView backend.
///
/// Feature repositories depend on [ApiClient], not on `Dio` directly, so the
/// transport can be mocked in tests or swapped later without touching
/// feature/domain code.
abstract class ApiClient {
  Future<Response<T>> get<T>(String path, {Map<String, dynamic>? queryParameters});

  Future<Response<T>> post<T>(
    String path, {
    Object? data,
    void Function(int sent, int total)? onSendProgress,
    Duration? sendTimeout,
  });

  Future<Response<T>> put<T>(String path, {Object? data});

  Future<Response<T>> patch<T>(String path, {Object? data});

  Future<Response<T>> delete<T>(String path, {Object? data});
}

class DioApiClient implements ApiClient {
  DioApiClient({required SecureStorage secureStorage, Dio? dio})
      // ignore: prefer_initializing_formals
      : _secureStorage = secureStorage,
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: AppConfig.apiBaseUrl,
                connectTimeout: AppConfig.apiConnectTimeout,
                receiveTimeout: AppConfig.apiReceiveTimeout,
                headers: {'Content-Type': 'application/json'},
              ),
            ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _secureStorage.read(StorageKeys.accessToken);
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) {
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  final SecureStorage _secureStorage;

  @override
  Future<Response<T>> get<T>(String path, {Map<String, dynamic>? queryParameters}) =>
      _guard(() => _dio.get<T>(path, queryParameters: queryParameters));

  @override
  Future<Response<T>> post<T>(
    String path, {
    Object? data,
    void Function(int sent, int total)? onSendProgress,
    Duration? sendTimeout,
  }) =>
      _guard(
        () => _dio.post<T>(
          path,
          data: data,
          onSendProgress: onSendProgress,
          options: sendTimeout != null ? Options(sendTimeout: sendTimeout) : null,
        ),
      );

  @override
  Future<Response<T>> put<T>(String path, {Object? data}) =>
      _guard(() => _dio.put<T>(path, data: data));

  @override
  Future<Response<T>> patch<T>(String path, {Object? data}) =>
      _guard(() => _dio.patch<T>(path, data: data));

  @override
  Future<Response<T>> delete<T>(String path, {Object? data}) =>
      _guard(() => _dio.delete<T>(path, data: data));

  Future<Response<T>> _guard<T>(Future<Response<T>> Function() request) async {
    try {
      return await request();
    } on DioException catch (error) {
      throw _mapDioException(error);
    }
  }

  AppException _mapDioException(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
      case DioExceptionType.transformTimeout:
        return const NetworkException();
      case DioExceptionType.badResponse:
        final statusCode = error.response?.statusCode;
        if (statusCode == 401) {
          return const UnauthorizedException();
        }
        if (statusCode == 403) {
          return ForbiddenException(_extractMessage(error) ?? 'This action is not allowed.');
        }
        if (statusCode == 409) {
          return ConflictException(_extractMessage(error) ?? 'That value is already in use.');
        }
        if (statusCode == 429) {
          return RateLimitedException(_extractMessage(error) ?? 'Too many attempts. Please wait and try again.');
        }
        if (statusCode == 422) {
          return ValidationException(
            _extractMessage(error) ?? 'Validation failed',
            fieldErrors: _extractFieldErrors(error),
          );
        }
        return ServerException(
          _extractMessage(error) ?? 'Server error',
          statusCode: statusCode,
          cause: error,
        );
      case DioExceptionType.cancel:
      case DioExceptionType.badCertificate:
      case DioExceptionType.unknown:
        return UnknownException('Request failed', error);
    }
  }

  String? _extractMessage(DioException error) {
    final data = error.response?.data;
    if (data is Map && data['error'] is Map && data['error']['message'] is String) {
      return data['error']['message'] as String;
    }
    return null;
  }

  /// Backend validation errors carry zod's `{fieldErrors: {field: [msg, ...]}}`
  /// shape under `error.details`.
  Map<String, List<String>>? _extractFieldErrors(DioException error) {
    final data = error.response?.data;
    if (data is! Map) return null;
    final details = data['error'] is Map ? data['error']['details'] : null;
    final fieldErrors = details is Map ? details['fieldErrors'] : null;
    if (fieldErrors is! Map) return null;

    return fieldErrors.map(
      (key, value) => MapEntry(key as String, (value as List).cast<String>()),
    );
  }
}
