import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

/// A LIVE session's real, functional deep link — `xnakview://live/:id` (see
/// AndroidManifest.xml's intent-filter and app_router.dart's matching
/// route), same pattern as a video's real share link.
String liveShareLink(String liveSessionId) => 'xnakview://live/$liveSessionId';

/// Real Share panel for LIVE — Copy Link actually copies a working deep
/// link; "Share via…" hands off to Android's own share sheet, which
/// detects installed compatible apps dynamically.
Future<void> showLiveShareSheet(BuildContext context, {required String liveSessionId, required String title}) {
  final link = liveShareLink(liveSessionId);
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.black,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 36, height: 4, alignment: Alignment.center, decoration: BoxDecoration(color: Colors.grey.shade600, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 16),
            const Text('Share LIVE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.link, color: Colors.white),
              title: const Text('Copy link', style: TextStyle(color: Colors.white)),
              onTap: () async {
                await Clipboard.setData(ClipboardData(text: link));
                if (context.mounted) {
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied')));
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.ios_share, color: Colors.white),
              title: const Text('Share via…', style: TextStyle(color: Colors.white)),
              subtitle: const Text('Opens your device\'s share menu — only apps you actually have installed appear.', style: TextStyle(color: Colors.white54)),
              onTap: () {
                Navigator.of(context).pop();
                Share.share('$title\n$link');
              },
            ),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          ],
        ),
      ),
    ),
  );
}
