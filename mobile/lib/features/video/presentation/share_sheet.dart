import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../safety/domain/safety_models.dart';
import '../../safety/presentation/report_sheet.dart';
import '../domain/video_model.dart';

/// A video's real, functional deep link — `xnakview://video/:id` (see
/// AndroidManifest.xml's intent-filter). XNAKView has no deployed public web
/// domain, so this is honestly a custom URI scheme rather than a fabricated
/// `https://` URL: it resolves correctly on any device with XNAKView
/// installed, but does not open in a plain browser.
String videoShareLink(String videoId) => 'xnakview://video/$videoId';

/// Real Share panel (Create+Share rebuild) — Copy Link actually copies a
/// working deep link; "Share via…" hands off to Android's own share sheet
/// (`share_plus`), which detects installed compatible apps (WhatsApp,
/// Messenger, ...) dynamically — nothing here hardcodes an app that may not
/// be installed. Report reuses the existing, real safety-report flow.
Future<void> showShareSheet(BuildContext context, WidgetRef ref, VideoModel video) {
  return showModalBottomSheet<void>(
    context: context,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => _ShareSheet(video: video),
  );
}

class _ShareSheet extends StatelessWidget {
  const _ShareSheet({required this.video});

  final VideoModel video;

  @override
  Widget build(BuildContext context) {
    final link = videoShareLink(video.id);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 36, height: 4, alignment: Alignment.center, decoration: BoxDecoration(color: Colors.grey.shade400, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 16),
            const Text('Share', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.link),
              title: const Text('Copy link'),
              onTap: () async {
                await Clipboard.setData(ClipboardData(text: link));
                if (context.mounted) {
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied')));
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.ios_share),
              title: const Text('Share via…'),
              subtitle: const Text('Opens your device’s share menu — only apps you actually have installed appear.'),
              onTap: () {
                Navigator.of(context).pop();
                final caption = video.caption;
                Share.share(caption != null && caption.isNotEmpty ? '$caption\n$link' : link);
              },
            ),
            ListTile(
              leading: const Icon(Icons.flag_outlined, color: Colors.redAccent),
              title: const Text('Report', style: TextStyle(color: Colors.redAccent)),
              onTap: () {
                Navigator.of(context).pop();
                showReportSheet(context, targetType: ReportTargetType.video, targetId: video.id, targetUserId: video.author?.id);
              },
            ),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          ],
        ),
      ),
    );
  }
}
