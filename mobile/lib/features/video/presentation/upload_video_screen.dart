import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/video_edit_spec.dart';
import '../domain/video_model.dart';
import 'video_providers.dart';

enum _PostStage { form, uploading, processing, done, failed }

/// The final Post screen (Step 3 rebuild) — reached only after the real
/// video editor (video_editor_screen.dart), never directly from Gallery/
/// Camera selection. `file`/`editSpec` are always already-decided by the
/// time this screen opens; this screen's only job is caption/privacy/
/// permissions metadata and the actual upload.
class PostVideoScreen extends ConsumerStatefulWidget {
  const PostVideoScreen({
    super.key,
    required this.file,
    required this.editSpec,
    this.soundId,
    this.epidemicTrackId,
    this.epidemicTrackTitle,
    this.epidemicTrackArtist,
    this.voiceoverFile,
  });

  final File file;
  final VideoEditSpec editSpec;
  final String? soundId;
  /// Real licensed music (Epidemic Sound Partner Content API) — mutually
  /// exclusive with [soundId].
  final String? epidemicTrackId;
  final String? epidemicTrackTitle;
  final String? epidemicTrackArtist;
  final File? voiceoverFile;

  @override
  ConsumerState<PostVideoScreen> createState() => _PostVideoScreenState();
}

class _PostVideoScreenState extends ConsumerState<PostVideoScreen> {
  final _captionController = TextEditingController();
  final _addYoursPromptController = TextEditingController();
  VideoVisibility _visibility = VideoVisibility.public;
  _PostStage _stage = _PostStage.form;
  double _uploadProgress = 0;
  String? _errorMessage;
  bool _allowDuet = true;
  bool _allowStitch = true;
  bool _allowDownload = true;
  bool _allowComments = true;

  Future<void> _submit() async {
    setState(() {
      _stage = _PostStage.uploading;
      _uploadProgress = 0;
      _errorMessage = null;
    });

    try {
      final video = await ref.read(videoRepositoryProvider).uploadVideo(
            file: widget.file,
            caption: _captionController.text.trim(),
            visibility: _visibility,
            addYoursPrompt: _addYoursPromptController.text.trim(),
            soundId: widget.soundId,
            epidemicTrackId: widget.epidemicTrackId,
            epidemicTrackTitle: widget.epidemicTrackTitle,
            epidemicTrackArtist: widget.epidemicTrackArtist,
            allowDuet: _allowDuet,
            allowStitch: _allowStitch,
            allowDownload: _allowDownload,
            allowComments: _allowComments,
            editSpec: widget.editSpec.toJson(),
            voiceoverFile: widget.voiceoverFile,
            onProgress: (progress) {
              if (mounted) setState(() => _uploadProgress = progress);
            },
          );
      setState(() => _stage = _PostStage.processing);
      _pollProcessing(video.id);
    } on AppException catch (error) {
      setState(() {
        _stage = _PostStage.failed;
        _errorMessage = error.message;
      });
    }
  }

  Future<void> _pollProcessing(String videoId) async {
    const pollInterval = Duration(seconds: 1);
    const maxAttempts = 30;

    for (var attempt = 0; attempt < maxAttempts; attempt += 1) {
      await Future.delayed(pollInterval);
      if (!mounted) return;

      try {
        final video = await ref.read(videoRepositoryProvider).fetchVideo(videoId);
        if (video.status == VideoStatus.ready) {
          setState(() => _stage = _PostStage.done);
          return;
        }
        if (video.status == VideoStatus.failed) {
          setState(() {
            _stage = _PostStage.failed;
            _errorMessage = video.processingError ?? 'Processing failed';
          });
          return;
        }
      } on AppException catch (error) {
        setState(() {
          _stage = _PostStage.failed;
          _errorMessage = error.message;
        });
        return;
      }
    }

    if (mounted) {
      setState(() {
        _stage = _PostStage.failed;
        _errorMessage = 'Processing is taking longer than expected. Check back later.';
      });
    }
  }

  @override
  void dispose() {
    _captionController.dispose();
    _addYoursPromptController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Post')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _buildBody(),
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_stage) {
      case _PostStage.form:
        return _buildForm();
      case _PostStage.uploading:
        return _buildProgress('Uploading…', _uploadProgress);
      case _PostStage.processing:
        return _buildProgress('Rendering your edits and processing…', null);
      case _PostStage.done:
        return _buildDone();
      case _PostStage.failed:
        return _buildFailed();
    }
  }

  Widget _buildForm() {
    return ListView(
      children: [
        Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.green, size: 28),
            const SizedBox(width: 8),
            const Expanded(child: Text('Video ready — your edits will be applied when you post.')),
          ],
        ),
        if (widget.soundId != null || widget.epidemicTrackId != null) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.music_note_outlined, size: 18),
              const SizedBox(width: 4),
              Text(widget.epidemicTrackTitle != null ? 'Using "${widget.epidemicTrackTitle}"' : 'Using selected sound'),
            ],
          ),
        ],
        if (widget.voiceoverFile != null) ...[
          const SizedBox(height: 8),
          Row(children: const [Icon(Icons.mic, size: 18), SizedBox(width: 4), Text('Voice-over attached')]),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: _captionController,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Caption (optional)', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _addYoursPromptController,
          maxLength: 150,
          decoration: const InputDecoration(
            labelText: 'Add Yours prompt (optional)',
            hintText: 'e.g. your favorite summer memory',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        SegmentedButton<VideoVisibility>(
          segments: const [
            ButtonSegment(value: VideoVisibility.public, label: Text('Public'), icon: Icon(Icons.public)),
            ButtonSegment(value: VideoVisibility.private, label: Text('Private'), icon: Icon(Icons.lock_outline)),
          ],
          selected: {_visibility},
          onSelectionChanged: (selection) => setState(() => _visibility = selection.first),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Allow comments'),
          value: _allowComments,
          onChanged: (value) => setState(() => _allowComments = value),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Allow Duet'),
          value: _allowDuet,
          onChanged: (value) => setState(() => _allowDuet = value),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Allow Stitch'),
          value: _allowStitch,
          onChanged: (value) => setState(() => _allowStitch = value),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Allow download'),
          value: _allowDownload,
          onChanged: (value) => setState(() => _allowDownload = value),
        ),
        const SizedBox(height: 12),
        FilledButton(onPressed: _submit, child: const Text('Post')),
      ],
    );
  }

  Widget _buildProgress(String label, double? progress) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (progress != null)
            CircularProgressIndicator(value: progress)
          else
            const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(label),
          if (progress != null) Text('${(progress * 100).toStringAsFixed(0)}%'),
        ],
      ),
    );
  }

  Widget _buildDone() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.check_circle, color: Colors.green, size: 56),
          const SizedBox(height: 12),
          const Text('Your video is live!'),
          const SizedBox(height: 20),
          FilledButton(onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst), child: const Text('Done')),
        ],
      ),
    );
  }

  Widget _buildFailed() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, color: Theme.of(context).colorScheme.error, size: 56),
          const SizedBox(height: 12),
          Text(_errorMessage ?? 'Something went wrong', textAlign: TextAlign.center),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => setState(() => _stage = _PostStage.form),
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}
