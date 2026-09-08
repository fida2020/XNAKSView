import 'package:dio/dio.dart';
import 'package:xnakview/core/network/api_client.dart';

/// A hand-rolled fake for [ApiClient] — the abstraction exists precisely so
/// transport can be swapped/mocked in tests (see its own doc comment).
/// Register expected calls with [on]; by default a stub is persistent (it
/// answers every matching call, e.g. a screen polling the same endpoint
/// more than once) — pass `oneShot: true` for a stub that should only ever
/// be consumed once, useful for asserting an exact call count.
///
/// This avoids depending on a mocking package: every method on [ApiClient]
/// already returns/throws exactly what real app code branches on
/// ([AppException] subtypes), so a handler can simply return canned JSON or
/// throw the exception a real failure would produce.
class FakeApiClient implements ApiClient {
  final List<_Expectation> _expectations = [];
  final List<FakeApiCall> calls = [];

  void on(
    String method,
    String path, {
    Map<String, dynamic>? Function(Map<String, dynamic>? query, Object? data)? respond,
    Exception Function(Map<String, dynamic>? query, Object? data)? throwing,
    bool oneShot = false,
  }) {
    _expectations.add(_Expectation(method: method, path: path, respond: respond, throwing: throwing, oneShot: oneShot));
  }

  _Expectation _match(String method, String path) {
    // Exact match only — `startsWith` would let a stub for '/creator/diamonds'
    // incorrectly answer a call to '/creator/diamonds/history' too.
    final index = _expectations.indexWhere((e) => e.method == method && path == e.path);
    if (index == -1) {
      throw StateError('FakeApiClient: no expectation registered for $method $path');
    }
    final expectation = _expectations[index];
    if (expectation.oneShot) _expectations.removeAt(index);
    return expectation;
  }

  Future<Response<T>> _handle<T>(String method, String path, {Map<String, dynamic>? query, Object? data}) async {
    calls.add(FakeApiCall(method: method, path: path, query: query, data: data));
    final expectation = _match(method, path);
    if (expectation.throwing != null) {
      throw expectation.throwing!(query, data);
    }
    final json = expectation.respond?.call(query, data);
    return Response<T>(requestOptions: RequestOptions(path: path), statusCode: 200, data: json as T?);
  }

  @override
  Future<Response<T>> get<T>(String path, {Map<String, dynamic>? queryParameters}) =>
      _handle<T>('GET', path, query: queryParameters);

  @override
  Future<Response<T>> post<T>(String path, {Object? data, void Function(int sent, int total)? onSendProgress, Duration? sendTimeout}) =>
      _handle<T>('POST', path, data: data);

  @override
  Future<Response<T>> put<T>(String path, {Object? data}) => _handle<T>('PUT', path, data: data);

  @override
  Future<Response<T>> patch<T>(String path, {Object? data}) => _handle<T>('PATCH', path, data: data);

  @override
  Future<Response<T>> delete<T>(String path, {Object? data}) => _handle<T>('DELETE', path, data: data);
}

class _Expectation {
  _Expectation({required this.method, required this.path, this.respond, this.throwing, required this.oneShot});

  final String method;
  final String path;
  final Map<String, dynamic>? Function(Map<String, dynamic>? query, Object? data)? respond;
  final Exception Function(Map<String, dynamic>? query, Object? data)? throwing;
  final bool oneShot;
}

class FakeApiCall {
  FakeApiCall({required this.method, required this.path, this.query, this.data});

  final String method;
  final String path;
  final Map<String, dynamic>? query;
  final Object? data;
}
