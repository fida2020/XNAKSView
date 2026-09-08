import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:xnakview/core/errors/app_exception.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/core/router/app_router.dart';
import 'package:xnakview/features/auth/presentation/auth_controller.dart';
import 'package:xnakview/features/auth/presentation/sign_up_identifier_screen.dart';

import '../../support/fake_api_client.dart';
import '../../support/fake_secure_storage.dart';

Future<void> _pump(WidgetTester tester, FakeApiClient apiClient) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(apiClient),
        secureStorageProvider.overrideWithValue(FakeSecureStorage()),
      ],
      child: const MaterialApp(home: SignUpIdentifierScreen()),
    ),
  );
  await tester.pump();
}

/// A minimal real [GoRouter] (just this screen plus a placeholder at the
/// OTP-verify route) for the success-path tests, which navigate via
/// `context.pushOtpVerify(...)` — a plain [MaterialApp] has no [GoRouter] in
/// its context, so those calls would otherwise throw.
Future<void> _pumpWithRouter(WidgetTester tester, FakeApiClient apiClient) async {
  final router = GoRouter(
    initialLocation: AppRoutes.signUpIdentifier,
    routes: [
      GoRoute(path: AppRoutes.signUpIdentifier, builder: (context, state) => const SignUpIdentifierScreen()),
      GoRoute(path: AppRoutes.otpVerify, builder: (context, state) => const Scaffold(body: Text('OTP_VERIFY_PLACEHOLDER'))),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(apiClient),
        secureStorageProvider.overrideWithValue(FakeSecureStorage()),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('defaults to the Phone tab and rejects an empty submission', (tester) async {
    final apiClient = FakeApiClient();
    await _pump(tester, apiClient);

    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(find.text('Enter your phone number'), findsOneWidget);
    expect(apiClient.calls, isEmpty);
  });

  testWidgets('Phone -> Continue sends a REAL OTP request with the E.164 number, never a password field', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('POST', '/auth/otp/request', respond: (_, _) => {'maskedIdentifier': '+*******5678', 'expiresInSeconds': 300, 'resendAvailableInSeconds': 60});
    await _pumpWithRouter(tester, apiClient);

    expect(find.byType(TextField).evaluate().where((e) => (e.widget as TextField).obscureText).isEmpty, isTrue);

    await tester.enterText(find.byType(TextField), '3001234567');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final requestCalls = apiClient.calls.where((c) => c.method == 'POST' && c.path == '/auth/otp/request').toList();
    expect(requestCalls, hasLength(1));
    final body = requestCalls.single.data as Map<String, dynamic>;
    expect(body['phone'], '+923001234567');
    expect(body['purpose'], 'REGISTER');
    expect(body.containsKey('password'), isFalse);

    // Navigated to the OTP verification step.
    expect(find.text('OTP_VERIFY_PLACEHOLDER'), findsOneWidget);
  });

  testWidgets('switching to the Email tab and Continue sends a REAL OTP request for that email', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('POST', '/auth/otp/request', respond: (_, _) => {'maskedIdentifier': 'f***@example.com', 'expiresInSeconds': 300, 'resendAvailableInSeconds': 60});
    await _pumpWithRouter(tester, apiClient);

    await tester.tap(find.text('Email'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'fida@example.com');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final requestCalls = apiClient.calls.where((c) => c.method == 'POST' && c.path == '/auth/otp/request').toList();
    expect(requestCalls, hasLength(1));
    expect((requestCalls.single.data as Map<String, dynamic>)['email'], 'fida@example.com');
    expect(find.text('OTP_VERIFY_PLACEHOLDER'), findsOneWidget);
  });

  testWidgets('rejects an invalid email before ever calling the backend', (tester) async {
    final apiClient = FakeApiClient();
    await _pump(tester, apiClient);

    await tester.tap(find.text('Email'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'not-an-email');
    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(find.text('Enter a valid email address'), findsOneWidget);
    expect(apiClient.calls, isEmpty);
  });

  testWidgets('a CONFLICT (already registered) response shows the server message', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on(
      'POST',
      '/auth/otp/request',
      throwing: (_, _) => const ConflictException('Email is already registered'),
    );
    await _pump(tester, apiClient);

    await tester.tap(find.text('Email'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'taken@example.com');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Email is already registered'), findsOneWidget);
  });
}
