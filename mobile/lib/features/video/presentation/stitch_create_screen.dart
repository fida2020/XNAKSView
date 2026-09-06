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

const _maxSegmentMs = 5000;

/// Stitch creation (Step 6, brief F) — current TikTok behavior lets the
/// creator trim/select which up-to-5-second window of the source to use
/// (from anywhere in it, not just the start) before cutting to their own
/// recording. The actual trim+concat runs server-side (real ffmpeg, see
/// `lib/ffmpeg.ts`'s `compositeStitchConcat`) — this screen provides the
/// segment-selection scrubber, XNAKView's own UI rather than a copy of
/// TikTok's trimming screen.
class StitchCreateScreen extends ConsumerStatefulWidget {
  const StitchCreateScreen({super.key, required this.sourceVideoId});

  final String sourceVideoId;

  @override
  ConsumerState<StitchCreateScreen> createState() => _StitchCreateScreenState();
}

class _StitchCreateScreenState extends ConsumerState<StitchCreateScreen> {
  final _captionController = TextEditingController();
  File? _selectedFile;
  _Stage _stage = _Stage.picking;
  String? _errorMessage;
  VideoPlayerController? _sourceController;
  int _sourceDurationMs = _maxSegmentMs;
  double _segmentStartMs = 0;

  double get _segmentEndMs => (_segmentStartMs + _maxSegmentMs).clamp(0, _sourceDurationMs.toDouble());

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
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _sourceController = controller;
        _sourceDurationMs = video.durationMs ?? controller.value.duration.inMilliseconds;
      });
    } on AppException {
      // Reference preview is best-effort — the default 0-5000ms window still works without it.
    }
  }

  Future<void> _previewSegment() async {
    final controller = _sourceController;
    if (controller == null) return;
    await controller.seekTo(Duration(milliseconds: _segmentStartMs.round()));
    await controller.play();
    await Future.delayed(Duration(milliseconds: (_segmentEndMs - _segmentStartMs).round()));
    if (mounted) await controller.pause();
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
      await ref.read(videoRepositoryProvider).createStitch(
            sourceVideoId: widget.sourceVideoId,
            file: file,
            caption: _captionController.text.trim(),
            sourceStartMs: _segmentStartMs.round(),
            sourceEndMs: _segmentEndMs.round(),
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
      appBar: AppBar(title: const Text('Stitch')),
      body: SafeArea(
        child: switch (_stage) {
          _Stage.picking => _buildForm(),
          _Stage.uploading => const Center(child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 12),
                Text('Uploading and stitching your video…'),
              ],
            )),
          _Stage.done => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 56),
                  const SizedBox(height: 12),
                  const Text('Your Stitch is processing and will appear shortly!'),
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
    final maxStart = (_sourceDurationMs - 1).clamp(0, double.infinity).toDouble();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Select up to 5 seconds from the original', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          AspectRatio(
            aspectRatio: 9 / 16,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: _sourceController != null && _sourceController!.value.isInitialized
                  ? VideoPlayer(_sourceController!)
                  : Container(color: Colors.black12, child: const Center(child: CircularProgressIndicator())),
            ),
          ),
          const SizedBox(height: 8),
          if (maxStart > 0)
            Slider(
              value: _segmentStartMs.clamp(0, maxStart),
              min: 0,
              max: maxStart,
              onChanged: (value) => setState(() => _segmentStartMs = value),
              onChangeEnd: (_) => _previewSegment(),
            ),
          Text('${(_segmentStartMs / 1000).toStringAsFixed(1)}s – ${(_segmentEndMs / 1000).toStringAsFixed(1)}s of the original'),
          TextButton.icon(onPressed: _previewSegment, icon: const Icon(Icons.play_arrow), label: const Text('Preview segment')),
          const SizedBox(height: 8),
          const Text('Your recording', style: TextStyle(fontWeight: FontWeight.bold)),
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
          FilledButton(onPressed: _selectedFile == null ? null : _submit, child: const Text('Post Stitch')),
        ],
      ),
    );
  }
}
