import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors/app_exception.dart';
import '../domain/story_model.dart';
import 'stories_providers.dart';

/// Story creation (Step 6, brief D) — photo or video, expires in 24h
/// (server-authoritative — see `Story.expiresAt`, set once at creation and
/// enforced on every read, never the client's clock).
class CreateStoryScreen extends ConsumerStatefulWidget {
  const CreateStoryScreen({super.key});

  @override
  ConsumerState<CreateStoryScreen> createState() => _CreateStoryScreenState();
}

class _CreateStoryScreenState extends ConsumerState<CreateStoryScreen> {
  final _captionController = TextEditingController();
  File? _file;
  StoryMediaType? _mediaType;
  bool _isSubmitting = false;

  Future<void> _pickPhoto(ImageSource source) async {
    final picked = await ImagePicker().pickImage(source: source);
    if (picked != null) setState(() { _file = File(picked.path); _mediaType = StoryMediaType.photo; });
  }

  Future<void> _pickVideo(ImageSource source) async {
    final picked = await ImagePicker().pickVideo(source: source);
    if (picked != null) setState(() { _file = File(picked.path); _mediaType = StoryMediaType.video; });
  }

  Future<void> _submit() async {
    final file = _file;
    final mediaType = _mediaType;
    if (file == null || mediaType == null) return;
    setState(() => _isSubmitting = true);
    try {
      await ref.read(storiesRepositoryProvider).create(file: file, mediaType: mediaType, caption: _captionController.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
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
      appBar: AppBar(
        title: const Text('New story'),
        actions: [
          TextButton(
            onPressed: _isSubmitting || _file == null ? null : _submit,
            child: _isSubmitting ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Post'),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline), borderRadius: BorderRadius.circular(12)),
                  child: _file == null
                      ? const Center(child: Text('Pick a photo or video below'))
                      : _mediaType == StoryMediaType.photo
                          ? ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.file(_file!, fit: BoxFit.cover))
                          : const Center(child: Icon(Icons.videocam, size: 56)),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pickPhoto(ImageSource.camera), icon: const Icon(Icons.camera_alt_outlined), label: const Text('Photo'))),
                  const SizedBox(width: 8),
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pickVideo(ImageSource.camera), icon: const Icon(Icons.videocam_outlined), label: const Text('Video'))),
                  const SizedBox(width: 8),
                  Expanded(child: OutlinedButton.icon(onPressed: () => _pickPhoto(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: const Text('Gallery'))),
                ],
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _captionController,
                maxLength: 200,
                decoration: const InputDecoration(labelText: 'Caption (optional)', border: OutlineInputBorder()),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
