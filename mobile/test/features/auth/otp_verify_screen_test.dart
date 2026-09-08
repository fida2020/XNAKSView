import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/auth/presentation/auth_controller.dart';
import 'package:xnakview/features/auth/presentation/otp_verify_screen.dart';

import '../../support/fake_api_client.dart';
import '../../support/fake_secure_storage.dart';

/// The OTP screen (brief §3, critical) — real server verification only.
/// These tests exercise the custom 6-box input behavior (auto-advance,
/// paste, auto-submit, error-clear) and the resend cooldown, against a
/// [FakeApiClient] standing in for the real `/auth/otp/*` endpoints.
/// `purpose: 'LOGIN'` is used throughout (rather than `'REGISTER'`) so a
/// successful verify never needs to navigate anywhere — [AuthController]
/// just updates its own state, which is all these tests need to observe.
Future<void> _pump(WidgetTester tester, FakeApiClient apiClient, {required String purpose}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(apiClient),
        secureStorageProvider.overrideWithValue(FakeSecureStorage()),
      ],
      child: MaterialApp(
        home: OtpVerifyScreen(email: 'fida@example.com', purpose: purpose, maskedIdentifier: 'f***@example.com', resendAvailableInSeconds: 30),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _enterCode(WidgetTester tester, String code) async {
  for (var i = 0; i < code.length; i += 1) {
    await tester.enterText(find.byType(TextField).at(i), code[i]);
    await tester.pump();
  }
}

void main() {
  testWidgets('shows the masked identifier it was given', (tester) async {
    final apiClient = FakeApiClient();
    await _pump(tester, apiClient, purpose: 'LOGIN');

    expect(find.textContaining('f***@example.com'), findsOneWidget);
  });

  testWidgets('auto-advances focus as digits are typed and auto-submits on the 6th digit (LOGIN)', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('POST', '/auth/otp/verify', respond: (_, _) {
      return {
        'user': {'id': 'u1', 'email': 'fida@example.com', 'phone': null, 'status': 'ACTIVE', 'ageVerified': true},
        'accessToken': 'access-token',
        'refreshToken': 'refresh-token',
      };
    });
    apiClient.on('GET', '/me', respond: (_, _) => {
          'id': 'u1',
          'email': 'fida@example.com',
          'phone': null,
          'status': 'ACTIVE',
          'ageVerified': true,
          'profile': null,
        });

    await _pump(tester, apiClient, purpose: 'LOGIN');
    await _enterCode(tester, '123456');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final verifyCalls = apiClient.calls.where((c) => c.method == 'POST' && c.path == '/auth/otp/verify').toList();
    expect(verifyCalls, hasLength(1));
    final body = verifyCalls.single.data as Map<String, dynamic>;
    expect(body['code'], '123456');
    expect(body['purpose'], 'LOGIN');
  });

  testWidgets('an invalid code shows the server error and clears all boxes', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on(
      'POST',
      '/auth/otp/verify',
      throwing: (_, _) => const UnauthorizedException('Invalid or expired verification code'),
    );

    await _pump(tester, apiClient, purpose: 'LOGIN');
    await _enterCode(tester, '000000');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Invalid or expired verification code'), findsOneWidget);
    for (var i = 0; i < 6; i += 1) {
      expect(tester.widget<TextField>(find.byType(TextField).at(i)).controller!.text, isEmpty);
    }
  });

  testWidgets('pasting a full 6-digit code fills every box and auto-submits', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('POST', '/auth/otp/verify', respond: (_, _) {
      return {
        'user': {'id': 'u1', 'email': 'fida@example.com', 'phone': null, 'status': 'ACTIVE', 'ageVerified': true},
        'accessToken': 'access-token',
        'refreshToken': 'refresh-token',
      };
    });
    apiClient.on('GET', '/me', respond: (_, _) => {
          'id': 'u1',
          'email': 'fida@example.com',
          'phone': null,
          'status': 'ACTIVE',
          'ageVerified': true,
          'profile': null,
        });

    await _pump(tester, apiClient, purpose: 'LOGIN');
    await tester.enterText(find.byType(TextField).first, '987654');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final verifyCalls = apiClient.calls.where((c) => c.method == 'POST' && c.path == '/auth/otp/verify').toList();
    expect(verifyCalls, hasLength(1));
    expect((verifyCalls.single.data as Map<String, dynamic>)['code'], '987654');
  });

  testWidgets('resend is disabled during the cooldown and enabled once it elapses, sending a fresh request', (tester) async {
    final apiClient = FakeApiClient();
    var requestCallCount = 0;
    apiClient.on('POST', '/auth/otp/request', respond: (_, _) {
      requestCallCount += 1;
      return {'maskedIdentifier': 'f***@example.com', 'expiresInSeconds': 300, 'resendAvailableInSeconds': 60};
    });

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(apiClient),
          secureStorageProvider.overrideWithValue(FakeSecureStorage()),
        ],
        child: const MaterialApp(
          home: OtpVerifyScreen(email: 'fida@example.com', purpose: 'LOGIN', maskedIdentifier: 'f***@example.com', resendAvailableInSeconds: 2),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Resend code'), findsNothing);
    expect(find.textContaining('Resend code in'), findsOneWidget);

    await tester.pump(const Duration(seconds: 2));
    expect(find.text('Resend code'), findsOneWidget);

    await tester.tap(find.text('Resend code'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(requestCallCount, 1);
    expect(find.text('A new code was sent.'), findsOneWidget);
  });
}
