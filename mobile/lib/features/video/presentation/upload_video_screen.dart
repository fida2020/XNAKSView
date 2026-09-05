import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/video_model.dart';
import 'video_providers.dart';

enum _UploadStage { pickingCaption, uploading, processing, done, failed }

class UploadVideoScreen extends ConsumerStatefulWidget {
  const UploadVideoScreen({super.key});

  @override
  ConsumerState<UploadVideoScreen> createState() => _UploadVideoScreenState();
}

class _UploadVideoScreenState extends ConsumerState<UploadVideoScreen> {
  final _captionController = TextEditingController();
  File? _selectedFile;
  VideoVisibility _visibility = VideoVisibility.public;
  _UploadStage _stage = _UploadStage.pickingCaption;
  double _uploadProgress = 0;
  String? _errorMessage;
  VideoModel? _uploadedVideo;

  Future<void> _pickVideo() async {
    final picked = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (picked != null) {
      setState(() => _selectedFile = File(picked.path));
    }
  }

  Future<void> _submit() async {
    final file = _selectedFile;
    if (file == null) return;

    setState(() {
      _stage = _UploadStage.uploading;
      _uploadProgress = 0;
      _errorMessage = null;
    });

    try {
      final video = await ref.read(videoRepositoryProvider).uploadVideo(
            file: file,
            caption: _captionController.text.trim(),
            visibility: _visibility,
            onProgress: (progress) {
              if (mounted) setState(() => _uploadProgress = progress);
            },
          );
      setState(() {
        _stage = _UploadStage.processing;
        _uploadedVideo = video;
      });
      _pollProcessing(video.id);
    } on AppException catch (error) {
      setState(() {
        _stage = _UploadStage.failed;
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
          setState(() {
            _stage = _UploadStage.done;
            _uploadedVideo = video;
          });
          return;
        }
        if (video.status == VideoStatus.failed) {
          setState(() {
            _stage = _UploadStage.failed;
            _errorMessage = video.processingError ?? 'Processing failed';
          });
          return;
        }
      } on AppException catch (error) {
        setState(() {
          _stage = _UploadStage.failed;
          _errorMessage = error.message;
        });
        return;
      }
    }

    if (mounted) {
      setState(() {
        _stage = _UploadStage.failed;
        _errorMessage = 'Processing is taking longer than expected. Check back later.';
      });
    }
  }

  @override
  void dispose() {
    _captionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Upload video')),
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
      case _UploadStage.pickingCaption:
        return _buildPickAndCaptionForm();
      case _UploadStage.uploading:
        return _buildProgress('Uploading…', _uploadProgress);
      case _UploadStage.processing:
        return _buildProgress('Processing your video…', null);
      case _UploadStage.done:
        return _buildDone();
      case _UploadStage.failed:
        return _buildFailed();
    }
  }

  Widget _buildPickAndCaptionForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GestureDetector(
          onTap: _pickVideo,
          child: Container(
            height: 200,
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).colorScheme.outline),
              borderRadius: BorderRadius.circular(12),
            ),
            child: _selectedFile == null
                ? const Center(child: Text('Tap to select a video from your gallery'))
                : Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.check_circle, color: Colors.green, size: 40),
                        const SizedBox(height: 8),
                        Text(_selectedFile!.uri.pathSegments.last, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _captionController,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Caption (optional)', border: OutlineInputBorder()),
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
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _selectedFile == null ? null : _submit,
          child: const Text('Upload'),
        ),
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
          FilledButton(onPressed: () => Navigator.of(context).pop(_uploadedVideo), child: const Text('Done')),
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
            onPressed: () => setState(() => _stage = _UploadStage.pickingCaption),
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}
