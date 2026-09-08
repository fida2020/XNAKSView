import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/auth/presentation/auth_controller.dart';
import 'package:xnakview/features/auth/presentation/sign_up_credentials_screen.dart';

import '../../support/fake_api_client.dart';
import '../../support/fake_secure_storage.dart';

Future<void> _pump(WidgetTester tester, FakeApiClient apiClient) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(apiClient),
        secureStorageProvider.overrideWithValue(FakeSecureStorage()),
      ],
      child: MaterialApp(
        home: SignUpCredentialsScreen(email: 'fida@example.com', verificationToken: 'tok-123', dateOfBirth: DateTime(2000, 1, 1)),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('requires agreeing to Terms/Privacy before creating an account, even with a valid password', (tester) async {
    final apiClient = FakeApiClient();
    await _pump(tester, apiClient);

    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'Str0ng!Passw0rd');
    await tester.enterText(find.widgetWithText(TextFormField, 'Confirm password'), 'Str0ng!Passw0rd');
    await tester.tap(find.text('Create account'));
    await tester.pump();

    expect(find.text('You must agree to the Terms of Service and Privacy Policy'), findsOneWidget);
    expect(apiClient.calls, isEmpty);
  });

  testWidgets('rejects mismatched passwords', (tester) async {
    final apiClient = FakeApiClient();
    await _pump(tester, apiClient);

    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'Str0ng!Passw0rd');
    await tester.enterText(find.widgetWithText(TextFormField, 'Confirm password'), 'Different!1Aa');
    await tester.tap(find.byType(Checkbox));
    await tester.tap(find.text('Create account'));
    await tester.pump();

    expect(find.text('Passwords do not match'), findsOneWidget);
    expect(apiClient.calls, isEmpty);
  });

  testWidgets('a weak password is rejected before the backend is ever called', (tester) async {
    final apiClient = FakeApiClient();
    await _pump(tester, apiClient);

    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'weak');
    await tester.enterText(find.widgetWithText(TextFormField, 'Confirm password'), 'weak');
    await tester.tap(find.byType(Checkbox));
    await tester.tap(find.text('Create account'));
    await tester.pump();

    expect(apiClient.calls, isEmpty);
  });

  testWidgets('a valid password + agreed terms calls /auth/register with the verificationToken carried from OTP verification', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on('POST', '/auth/register', respond: (_, _) => {
          'user': {'id': 'u1', 'email': 'fida@example.com', 'phone': null, 'status': 'ACTIVE', 'ageVerified': true},
          'accessToken': 'access-token',
          'refreshToken': 'refresh-token',
        });
    await _pump(tester, apiClient);

    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'Str0ng!Passw0rd');
    await tester.enterText(find.widgetWithText(TextFormField, 'Confirm password'), 'Str0ng!Passw0rd');
    await tester.tap(find.byType(Checkbox));
    await tester.tap(find.text('Create account'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final registerCalls = apiClient.calls.where((c) => c.method == 'POST' && c.path == '/auth/register').toList();
    expect(registerCalls, hasLength(1));
    final body = registerCalls.single.data as Map<String, dynamic>;
    expect(body['email'], 'fida@example.com');
    expect(body['verificationToken'], 'tok-123');
    expect(body['password'], 'Str0ng!Passw0rd');
  });
}
