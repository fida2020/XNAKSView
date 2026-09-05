/// Base exception type for known, handleable failures across the app.
///
/// Feature-level exceptions should extend this rather than throwing raw
/// strings or platform exceptions, so the presentation layer can pattern
/// match on a single known type.
sealed class AppException implements Exception {
  const AppException(this.message, {this.cause});

  final String message;
  final Object? cause;

  @override
  String toString() => message;
}

class NetworkException extends AppException {
  // `message` can't be a super parameter here because `cause` (named on the
  // superclass) is passed explicitly alongside it, and Dart disallows mixing
  // super parameters with an explicit super() call in the same constructor.
  // ignore: use_super_parameters
  const NetworkException([String message = 'Network error. Please check your connection.', Object? cause])
      : super(message, cause: cause);
}

class ServerException extends AppException {
  const ServerException(super.message, {this.statusCode, super.cause});

  final int? statusCode;
}

class UnauthorizedException extends AppException {
  const UnauthorizedException([super.message = 'Session expired. Please sign in again.']);
}

class ValidationException extends AppException {
  const ValidationException(super.message, {this.fieldErrors});

  final Map<String, List<String>>? fieldErrors;
}

class UnknownException extends AppException {
  // ignore: use_super_parameters
  const UnknownException([String message = 'Something went wrong. Please try again.', Object? cause])
      : super(message, cause: cause);
}
