import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/storage/secure_storage.dart';
import '../../auth/presentation/auth_controller.dart';
import 'video_providers.dart';

enum _Stage { picking, uploading, done, failed }

/// Duet creation (Step 6, brief E) — current TikTok behavior composites the
/// source video and the new recording side by side into one output video.
/// That compositing runs server-side (real ffmpeg `hstack`, see
/// `lib/ffmpeg.ts`'s `compositeDuetSideBySide`) once the recording is
/// uploaded — this screen's job is to play the source alongside the
/// record/pick controls so the creator can watch and time their reaction
/// against it, the same reference experience current TikTok's Duet capture
/// screen provides, built with XNAKView's own UI rather than any copied
/// TikTok layout/assets.
class DuetCreateScreen extends ConsumerStatefulWidget {
  const DuetCreateScreen({super.key, required this.sourceVideoId});

  final String sourceVideoId;

  @override
  ConsumerState<DuetCreateScreen> createState() => _DuetCreateScreenState();
}

class _DuetCreateScreenState extends ConsumerState<DuetCreateScreen> {
  final _captionController = TextEditingController();
  File? _selectedFile;
  _Stage _stage = _Stage.picking;
  String? _errorMessage;
  VideoPlayerController? _sourceController;

  @override
  void initState() {
    super.initState();
    _initSourcePreview();
  }

  Future<void> _initSourcePreview() async {
    try {
      final video = await ref.read(videoRepositoryProvider).fetchVideo(widget.sourceVideoId);
      final playbackUrl = video.playbackUrl;
      if (playbackUrl == null) return;
      final token = await ref.read(secureStorageProvider).read(StorageKeys.accessToken);
      final controller = VideoPlayerController.networkUrl(
        AppConfig.resolveMediaUrl(playbackUrl),
        httpHeaders: {if (token != null) 'Authorization': 'Bearer $token'},
      );
      await controller.initialize();
      controller.setLooping(true);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _sourceController = controller);
    } on AppException {
      // Reference preview is best-effort — recording still works without it.
    }
  }

  Future<void> _pick(ImageSource source) async {
    final picked = await ImagePicker().pickVideo(source: source);
    if (picked != null) setState(() => _selectedFile = File(picked.path));
  }

  Future<void> _submit() async {
    final file = _selectedFile;
    if (file == null) return;
    setState(() => _stage = _Stage.uploading);
    try {
      await ref.read(videoRepositoryProvider).createDuet(
            sourceVideoId: widget.sourceVideoId,
            file: file,
            caption: _captionController.text.trim(),
          );
      if (mounted) setState(() => _stage = _Stage.done);
    } on AppException catch (error) {
      if (mounted) {
        setState(() {
          _stage = _Stage.failed;
          _errorMessage = error.message;
        });
      }
    }
  }

  @override
  void dispose() {
    _captionController.dispose();
    _sourceController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Duet')),
      body: SafeArea(
        child: switch (_stage) {
          _Stage.picking => _buildForm(),
          _Stage.uploading => const Center(child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 12),
                Text('Uploading and compositing your Duet…'),
              ],
            )),
          _Stage.done => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 56),
                  const SizedBox(height: 12),
                  const Text('Your Duet is processing and will appear shortly!'),
                  const SizedBox(height: 20),
                  FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
                ],
              ),
            ),
          _Stage.failed => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.error_outline, color: Theme.of(context).colorScheme.error, size: 56),
                    const SizedBox(height: 12),
                    Text(_errorMessage ?? 'Something went wrong', textAlign: TextAlign.center),
                    const SizedBox(height: 20),
                    FilledButton(onPressed: () => setState(() => _stage = _Stage.picking), child: const Text('Try again')),
                  ],
                ),
              ),
            ),
        },
      ),
    );
  }

  Widget _buildForm() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Original', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          AspectRatio(
            aspectRatio: 9 / 16,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: _sourceController != null && _sourceController!.value.isInitialized
                  ? GestureDetector(
                      onTap: () => setState(() {
                        _sourceController!.value.isPlaying ? _sourceController!.pause() : _sourceController!.play();
                      }),
                      child: VideoPlayer(_sourceController!),
                    )
                  : Container(color: Colors.black12, child: const Center(child: CircularProgressIndicator())),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Your response', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pick(ImageSource.camera),
                  icon: const Icon(Icons.videocam_outlined),
                  label: const Text('Record'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('Gallery'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_selectedFile != null)
            Text('Selected: ${_selectedFile!.uri.pathSegments.last}', overflow: TextOverflow.ellipsis),
          const SizedBox(height: 16),
          TextField(
            controller: _captionController,
            maxLength: 500,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Caption (optional)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: _selectedFile == null ? null : _submit, child: const Text('Post Duet')),
        ],
      ),
    );
  }
}
