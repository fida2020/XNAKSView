import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import '../domain/live_session_model.dart';
import 'live_providers.dart';
import 'live_viewer_screen.dart';
import 'start_live_screen.dart';

/// LIVE discovery/listing — the entry point for both watching and going LIVE.
class LiveDiscoveryScreen extends ConsumerStatefulWidget {
  const LiveDiscoveryScreen({super.key});

  @override
  ConsumerState<LiveDiscoveryScreen> createState() => _LiveDiscoveryScreenState();
}

class _LiveDiscoveryScreenState extends ConsumerState<LiveDiscoveryScreen> {
  List<LiveSessionModel> _sessions = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final page = await ref.read(liveRepositoryProvider).discover();
      if (mounted) setState(() => _sessions = page.liveSessions);
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('LIVE'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          ),
        ],
      ),
      body: RefreshIndicator(onRefresh: _load, child: _buildBody()),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StartLiveScreen())),
        icon: const Icon(Icons.videocam),
        label: const Text('Go LIVE'),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return ListView(
        children: [
          const SizedBox(height: 80),
          Center(child: Text(_error!)),
          const SizedBox(height: 12),
          Center(child: FilledButton(onPressed: _load, child: const Text('Retry'))),
        ],
      );
    }
    if (_sessions.isEmpty) {
      return ListView(
        children: const [
          SizedBox(height: 120),
          Center(child: Text('Nobody is LIVE right now — be the first!')),
        ],
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(8),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 0.8,
      ),
      itemCount: _sessions.length,
      itemBuilder: (context, index) => _LiveSessionCard(session: _sessions[index]),
    );
  }
}

class _LiveSessionCard extends ConsumerWidget {
  const _LiveSessionCard({required this.session});

  final LiveSessionModel session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isOwn = session.hostId == ref.read(authControllerProvider).userId;

    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => LiveViewerScreen(liveSessionId: session.id)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(color: Colors.black87),
            if (session.thumbnailUrl != null) _AuthenticatedThumbnail(path: session.thumbnailUrl!),
            Positioned(
              top: 8,
              left: 8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: Colors.red, borderRadius: BorderRadius.circular(4)),
                child: const Text('LIVE', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: Row(
                children: [
                  const Icon(Icons.remove_red_eye, color: Colors.white, size: 14),
                  const SizedBox(width: 2),
                  Text('${session.viewerCount}', style: const TextStyle(color: Colors.white, fontSize: 12)),
                ],
              ),
            ),
            Positioned(
              left: 8,
              right: 8,
              bottom: 8,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    session.title,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    isOwn ? 'You' : (session.host?.displayLabel ?? 'Unknown creator'),
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
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
