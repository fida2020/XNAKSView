import 'package:equatable/equatable.dart';

enum AccountStatus { pendingVerification, active, suspended, banned, deleted, unknown }

AccountStatus accountStatusFromApi(String value) {
  switch (value) {
    case 'PENDING_VERIFICATION':
      return AccountStatus.pendingVerification;
    case 'ACTIVE':
      return AccountStatus.active;
    case 'SUSPENDED':
      return AccountStatus.suspended;
    case 'BANNED':
      return AccountStatus.banned;
    case 'DELETED':
      return AccountStatus.deleted;
    default:
      return AccountStatus.unknown;
  }
}

class UserAccount extends Equatable {
  const UserAccount({
    required this.id,
    required this.email,
    required this.phone,
    required this.status,
    required this.ageVerified,
  });

  factory UserAccount.fromJson(Map<String, dynamic> json) {
    return UserAccount(
      id: json['id'] as String,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      status: accountStatusFromApi(json['status'] as String),
      ageVerified: json['ageVerified'] as bool,
    );
  }

  final String id;
  final String? email;
  final String? phone;
  final AccountStatus status;
  final bool ageVerified;

  @override
  List<Object?> get props => [id, email, phone, status, ageVerified];
}

class ProfileModel extends Equatable {
  const ProfileModel({
    required this.username,
    this.displayName,
    this.bio,
    this.avatarUrl,
    this.country,
    this.city,
  });

  factory ProfileModel.fromJson(Map<String, dynamic> json) {
    return ProfileModel(
      username: json['username'] as String,
      displayName: json['displayName'] as String?,
      bio: json['bio'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      country: json['country'] as String?,
      city: json['city'] as String?,
    );
  }

  final String username;
  final String? displayName;
  final String? bio;
  final String? avatarUrl;
  final String? country;
  final String? city;

  @override
  List<Object?> get props => [username, displayName, bio, avatarUrl, country, city];
}

class MeResult extends Equatable {
  const MeResult({required this.user, required this.profile});

  factory MeResult.fromJson(Map<String, dynamic> json) {
    return MeResult(
      user: UserAccount.fromJson(json),
      profile: json['profile'] == null ? null : ProfileModel.fromJson(json['profile'] as Map<String, dynamic>),
    );
  }

  final UserAccount user;
  final ProfileModel? profile;

  @override
  List<Object?> get props => [user, profile];
}

/// Result of `/auth/otp/request` — a real code was (or, for a LOGIN request
/// against a non-existent/inactive account, was deliberately NOT) sent.
/// `maskedIdentifier` is what the OTP screen shows (`f***@example.com` /
/// `+*******2671`) — the full identifier is never echoed back.
class OtpRequestResult extends Equatable {
  const OtpRequestResult({
    required this.maskedIdentifier,
    required this.expiresInSeconds,
    required this.resendAvailableInSeconds,
  });

  factory OtpRequestResult.fromJson(Map<String, dynamic> json) {
    return OtpRequestResult(
      maskedIdentifier: json['maskedIdentifier'] as String,
      expiresInSeconds: json['expiresInSeconds'] as int,
      resendAvailableInSeconds: json['resendAvailableInSeconds'] as int,
    );
  }

  final String maskedIdentifier;
  final int expiresInSeconds;
  final int resendAvailableInSeconds;

  @override
  List<Object?> get props => [maskedIdentifier, expiresInSeconds, resendAvailableInSeconds];
}

/// One of three real outcomes from `/auth/oauth/authenticate` — never a
/// single "success" shape, since which screen comes next genuinely
/// differs (direct login vs. account-linking re-auth vs. new-signup
/// profile setup).
sealed class OAuthAuthResult {}

class OAuthLoginResult extends OAuthAuthResult {
  OAuthLoginResult({required this.session});
  final AuthSessionResult session;
}

class OAuthNeedsLinkingResult extends OAuthAuthResult {
  OAuthNeedsLinkingResult({required this.linkingToken, required this.maskedEmail});
  final String linkingToken;
  final String maskedEmail;
}

class OAuthNewSignupResult extends OAuthAuthResult {
  OAuthNewSignupResult({required this.socialSignupToken, this.email, this.suggestedUsername, this.name, this.pictureUrl});
  final String socialSignupToken;
  final String? email;
  final String? suggestedUsername;
  final String? name;
  final String? pictureUrl;
}

class AuthSessionResult extends Equatable {
  const AuthSessionResult({required this.user, required this.accessToken, required this.refreshToken});

  factory AuthSessionResult.fromJson(Map<String, dynamic> json) {
    return AuthSessionResult(
      user: UserAccount.fromJson(json['user'] as Map<String, dynamic>),
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );
  }

  final UserAccount user;
  final String accessToken;
  final String refreshToken;

  @override
  List<Object?> get props => [user, accessToken, refreshToken];
}
