import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:xnakview/app/app.dart';

void main() {
  testWidgets('App boots and shows the splash screen first', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: XnakViewApp()));
    await tester.pump();

    // The splash screen shows the XNAKView wordmark logo (with "XNAKView"
    // baked into the artwork) rather than a separate text widget.
    final logoFinder = find.byWidgetPredicate(
      (widget) => widget is Image && widget.image is AssetImage && (widget.image as AssetImage).assetName == 'assets/branding/xnakview_logo.png',
    );
    expect(logoFinder, findsOneWidget);
  });
}
