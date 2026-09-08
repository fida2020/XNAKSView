import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xnakview/core/network/api_client_provider.dart';
import 'package:xnakview/features/safety/domain/safety_models.dart';
import 'package:xnakview/features/safety/presentation/appeal_sheet.dart';
import 'package:xnakview/features/safety/presentation/report_sheet.dart';

import '../../support/fake_api_client.dart';

void main() {
  testWidgets('submitting an appeal posts the reason and shows the under-review result', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on(
      'POST',
      '/enforcement-actions/action-1/appeal',
      respond: (_, data) {
        expect((data as Map)['reason'], 'This was a misunderstanding.');
        return {'id': 'appeal-1', 'status': 'UNDER_REVIEW', 'decisionNotes': null};
      },
    );

    late BuildContext capturedContext;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const Scaffold(body: SizedBox());
            },
          ),
        ),
      ),
    );

    showAppealSheet(capturedContext, enforcementActionId: 'action-1');
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'This was a misunderstanding.');
    await tester.tap(find.widgetWithText(FilledButton, 'Submit appeal'));
    await tester.pumpAndSettle();

    expect(find.textContaining('under review'), findsOneWidget);
  });

  testWidgets('the report sheet requires a reason before submitting', (tester) async {
    final apiClient = FakeApiClient();
    late BuildContext capturedContext;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const Scaffold(body: SizedBox());
            },
          ),
        ),
      ),
    );

    showReportSheet(capturedContext, targetType: ReportTargetType.videoComment, targetId: 'comment-1', targetUserId: 'user-1');
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Submit report'));
    await tester.tap(find.widgetWithText(FilledButton, 'Submit report'));
    await tester.pump();

    expect(find.text('Choose a reason for this report.'), findsOneWidget);
    expect(apiClient.calls, isEmpty);
  });

  testWidgets('selecting a reason and submitting creates a normalized safety report', (tester) async {
    final apiClient = FakeApiClient();
    apiClient.on(
      'POST',
      '/safety/reports',
      respond: (_, data) {
        final body = data as Map;
        expect(body['targetType'], 'VIDEO_COMMENT');
        expect(body['targetId'], 'comment-1');
        expect(body['reasonCategory'], 'SPAM');
        return {'id': 'report-1', 'status': 'OPEN', 'createdAt': '2026-01-01T00:00:00.000Z'};
      },
    );

    late BuildContext capturedContext;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(apiClient)],
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const Scaffold(body: SizedBox());
            },
          ),
        ),
      ),
    );

    showReportSheet(capturedContext, targetType: ReportTargetType.videoComment, targetId: 'comment-1', targetUserId: 'user-1');
    await tester.pumpAndSettle();

    await tester.tap(find.text('Spam'));
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Submit report'));
    await tester.tap(find.widgetWithText(FilledButton, 'Submit report'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Thanks for reporting'), findsOneWidget);
  });
}
