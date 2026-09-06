import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart' show secureStorageProvider;
import 'feed_controller.dart';
import 'video_page_view.dart';

/// Response viewing (Step 6, brief G) — every video that responded to a
/// given Add Yours prompt, browsable as a chain.
class AddYoursResponsesScreen extends ConsumerWidget {
  const AddYoursResponsesScreen({super.key, required this.promptVideoId});

  final String promptVideoId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(addYoursResponsesControllerProvider(promptVideoId));

    return Scaffold(
      appBar: AppBar(title: const Text('Responses')),
      body: state.videos.isEmpty && state.status == FeedLoadStatus.loading
          ? const Center(child: CircularProgressIndicator())
          : state.videos.isEmpty
              ? const Center(child: Text('No responses yet — be the first!'))
              : GridView.builder(
                  padding: const EdgeInsets.all(2),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 2, mainAxisSpacing: 2, childAspectRatio: 9 / 16),
                  itemCount: state.videos.length,
                  itemBuilder: (context, index) {
                    final video = state.videos[index];
                    return GestureDetector(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => Scaffold(
                            backgroundColor: Colors.black,
                            body: VideoPageView(controllerProvider: addYoursResponsesControllerProvider(promptVideoId), initialIndex: index),
                          ),
                        ),
                      ),
                      child: video.thumbnailUrl == null
                          ? Container(color: Colors.black12, child: const Icon(Icons.hourglass_empty))
                          : _AuthenticatedThumbnail(path: video.thumbnailUrl!),
                    );
                  },
                ),
    );
  }
}

class _AuthenticatedThumbnail extends ConsumerWidget {
  const _AuthenticatedThumbnail({required this.path});

  final String path;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<String?>(
      future: ref.read(secureStorageProvider).read(StorageKeys.accessToken),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox.shrink();
        final uri = AppConfig.resolveMediaUrl(path);
        return Image.network(
          uri.toString(),
          headers: {'Authorization': 'Bearer ${snapshot.data}'},
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
        );
      },
    );
  }
}
