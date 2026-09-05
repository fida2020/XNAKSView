import 'package:equatable/equatable.dart';

/// Authentication status for the whole app. Feature 2 (Authentication) will
/// populate this with real sign-in/sign-up flows; for now it only models the
/// states routing and UI need to be aware of at startup.
enum AuthStatus { unknown, unauthenticated, authenticated }

class AuthState extends Equatable {
  const AuthState({this.status = AuthStatus.unknown, this.userId, this.hasProfile = false});

  final AuthStatus status;
  final String? userId;

  /// Whether the authenticated user has completed profile setup
  /// (username/displayName/etc.) — drives whether routing sends them to
  /// profile setup or straight to the home shell.
  final bool hasProfile;

  AuthState copyWith({AuthStatus? status, String? userId, bool? hasProfile}) {
    return AuthState(
      status: status ?? this.status,
      userId: userId ?? this.userId,
      hasProfile: hasProfile ?? this.hasProfile,
    );
  }

  @override
  List<Object?> get props => [status, userId, hasProfile];
}
