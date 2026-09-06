import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors/app_exception.dart';
import 'video_providers.dart';

enum _Stage { picking, uploading, done, failed }

/// Add Yours response (Step 6, brief G) — current TikTok behavior: a
/// prompt sticker on a video, and anyone can respond with their own video
/// tagged to that prompt, browsable as a chain of responses. Real upload
/// against `POST /videos/:id/add-yours`, only possible when the source
/// actually carries a prompt (server-enforced, never inferred client-side).
class AddYoursResponseScreen extends ConsumerStatefulWidget {
  const AddYoursResponseScreen({super.key, required this.promptVideoId, required this.prompt});

  final String promptVideoId;
  final String prompt;

  @override
  ConsumerState<AddYoursResponseScreen> createState() => _AddYoursResponseScreenState();
}

class _AddYoursResponseScreenState extends ConsumerState<AddYoursResponseScreen> {
  final _captionController = TextEditingController();
  File? _selectedFile;
  _Stage _stage = _Stage.picking;
  String? _errorMessage;

  Future<void> _pick(ImageSource source) async {
    final picked = await ImagePicker().pickVideo(source: source);
    if (picked != null) setState(() => _selectedFile = File(picked.path));
  }

  Future<void> _submit() async {
    final file = _selectedFile;
    if (file == null) return;
    setState(() => _stage = _Stage.uploading);
    try {
      await ref.read(videoRepositoryProvider).respondToAddYours(
            promptVideoId: widget.promptVideoId,
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add Yours')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: switch (_stage) {
            _Stage.picking => _buildForm(),
            _Stage.uploading => const Center(child: CircularProgressIndicator()),
            _Stage.done => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.check_circle, color: Colors.green, size: 56),
                    const SizedBox(height: 12),
                    const Text('Your response is live!'),
                    const SizedBox(height: 20),
                    FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Done')),
                  ],
                ),
              ),
            _Stage.failed => Center(
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
          },
        ),
      ),
    );
  }

  Widget _buildForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)),
          child: Row(
            children: [
              const Icon(Icons.auto_awesome),
              const SizedBox(width: 8),
              Expanded(child: Text(widget.prompt, style: const TextStyle(fontWeight: FontWeight.bold))),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => _pick(ImageSource.camera), icon: const Icon(Icons.videocam_outlined), label: const Text('Record'))),
            const SizedBox(width: 12),
            Expanded(child: OutlinedButton.icon(onPressed: () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: const Text('Gallery'))),
          ],
        ),
        const SizedBox(height: 16),
        if (_selectedFile != null) Text('Selected: ${_selectedFile!.uri.pathSegments.last}', overflow: TextOverflow.ellipsis),
        const SizedBox(height: 16),
        TextField(
          controller: _captionController,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Caption (optional)', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 20),
        FilledButton(onPressed: _selectedFile == null ? null : _submit, child: const Text('Post response')),
      ],
    );
  }
}
