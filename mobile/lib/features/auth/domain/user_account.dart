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
