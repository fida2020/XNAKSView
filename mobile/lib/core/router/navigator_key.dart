import 'package:flutter/widgets.dart';

/// The root navigator key, shared by [GoRouter] (see `app_router.dart`) and
/// anything that needs to push a route without a `BuildContext` of its own —
/// e.g. `CallListener` reacting to a realtime `call:incoming` event.
final navigatorKey = GlobalKey<NavigatorState>();
