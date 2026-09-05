import 'package:equatable/equatable.dart';

/// Authentication status for the whole app. Feature 2 (Authentication) will
/// populate this with real sign-in/sign-up flows; for now it only models the
/// states routing and UI need to be aware of at startup.
enum AuthStatus { unknown, unauthenticated, authenticated }

class AuthState extends Equatable {
  const AuthState({this.status = AuthStatus.unknown, this.userId});

  final AuthStatus status;
  final String? userId;

  AuthState copyWith({AuthStatus? status, String? userId}) {
    return AuthState(
      status: status ?? this.status,
      userId: userId ?? this.userId,
    );
  }

  @override
  List<Object?> get props => [status, userId];
}
