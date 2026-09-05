import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:xnakview/app/app.dart';

void main() {
  testWidgets('App boots and shows the splash screen first', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: XnakViewApp()));
    await tester.pump();

    expect(find.text('XNAKView'), findsOneWidget);
  });
}
