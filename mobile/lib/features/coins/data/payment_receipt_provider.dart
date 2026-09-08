/// Thrown when a payment provider cannot produce a real receipt in this
/// build/environment — the client-side mirror of how the backend's own
/// `AppStoreProvider`/`GooglePlayProvider`/`WebPaymentProvider` each refuse
/// to verify anything (never fake success) when their credentials aren't
/// configured (see backend `lib/paymentProviders.ts`).
class PaymentNotAvailableException implements Exception {
  const PaymentNotAvailableException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Obtains a provider-specific purchase receipt to hand to
/// `POST /coins/purchases/:id/verify`. This is a real integration seam, not
/// a placeholder: a working implementation plugs in here without touching
/// anything upstream (the purchase-creation flow, the verify call, the
/// balance refresh). What's real *today* is the honest refusal below —
/// completing an actual purchase needs pieces that don't exist yet in this
/// codebase/environment:
///   - App Store / Google Play: a native IAP integration (the
///     `in_app_purchase` package, wired to real product IDs configured in
///     App Store Connect / Google Play Console) that this repo does not
///     have set up.
///   - Web: the backend's `WebPaymentProvider` verifies an HMAC signature
///     produced with a server-only secret — by design, no mobile client can
///     legitimately produce that signature itself. A real Web purchase
///     needs a hosted checkout (a real payment gateway) whose webhook signs
///     the receipt server-side; XNAKView has no such storefront deployed.
/// Faking either of these would mean the client asserting "payment
/// succeeded" on its own authority, which is exactly what the whole Coins
/// architecture (server-verified receipts, never a client flag) exists to
/// prevent.
abstract class PaymentReceiptProvider {
  Future<String> obtainReceipt({required String purchaseId, required int totalUsdCents});
}

class AppStoreReceiptProvider implements PaymentReceiptProvider {
  const AppStoreReceiptProvider();

  @override
  Future<String> obtainReceipt({required String purchaseId, required int totalUsdCents}) {
    throw const PaymentNotAvailableException(
      'App Store purchases aren\'t available in this build yet — native in-app purchase isn\'t configured.',
    );
  }
}

class GooglePlayReceiptProvider implements PaymentReceiptProvider {
  const GooglePlayReceiptProvider();

  @override
  Future<String> obtainReceipt({required String purchaseId, required int totalUsdCents}) {
    throw const PaymentNotAvailableException(
      'Google Play purchases aren\'t available in this build yet — native in-app purchase isn\'t configured.',
    );
  }
}

class WebPaymentReceiptProvider implements PaymentReceiptProvider {
  const WebPaymentReceiptProvider();

  @override
  Future<String> obtainReceipt({required String purchaseId, required int totalUsdCents}) {
    throw const PaymentNotAvailableException(
      'Web checkout isn\'t available in this build yet — no hosted payment page is deployed.',
    );
  }
}
