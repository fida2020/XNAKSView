import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors/app_exception.dart';
import '../../video/domain/video_model.dart';
import 'photo_post_providers.dart';

const _minPhotos = 2;
const _maxPhotos = 35;

/// Photo post / carousel creation (Step 6, brief A) — current TikTok Photo
/// Mode: 2-35 manually-swiped images sharing one caption.
class CreatePhotoPostScreen extends ConsumerStatefulWidget {
  const CreatePhotoPostScreen({super.key});

  @override
  ConsumerState<CreatePhotoPostScreen> createState() => _CreatePhotoPostScreenState();
}

class _CreatePhotoPostScreenState extends ConsumerState<CreatePhotoPostScreen> {
  final _captionController = TextEditingController();
  final List<File> _photos = [];
  VideoVisibility _visibility = VideoVisibility.public;
  bool _isSubmitting = false;

  Future<void> _addPhotos() async {
    final remaining = _maxPhotos - _photos.length;
    if (remaining <= 0) return;
    final picked = await ImagePicker().pickMultiImage(limit: remaining);
    if (picked.isEmpty) return;
    setState(() => _photos.addAll(picked.map((p) => File(p.path))));
  }

  Future<void> _submit() async {
    if (_photos.length < _minPhotos) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Add at least $_minPhotos photos')));
      return;
    }
    setState(() => _isSubmitting = true);
    try {
      await ref.read(photoPostRepositoryProvider).create(
            photos: _photos,
            caption: _captionController.text.trim(),
            visibility: _visibility == VideoVisibility.private ? 'PRIVATE' : 'PUBLIC',
          );
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
        title: const Text('New photo post'),
        actions: [
          TextButton(
            onPressed: _isSubmitting ? null : _submit,
            child: _isSubmitting
                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Post'),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('${_photos.length} / $_maxPhotos photos (minimum $_minPhotos)'),
              const SizedBox(height: 8),
              Expanded(
                child: GridView.builder(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 4, mainAxisSpacing: 4),
                  itemCount: _photos.length + 1,
                  itemBuilder: (context, index) {
                    if (index == _photos.length) {
                      return GestureDetector(
                        onTap: _addPhotos,
                        child: Container(
                          decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline)),
                          child: const Icon(Icons.add_a_photo_outlined),
                        ),
                      );
                    }
                    final photo = _photos[index];
                    return Stack(
                      fit: StackFit.expand,
                      children: [
                        Image.file(photo, fit: BoxFit.cover),
                        Positioned(
                          top: 0,
                          right: 0,
                          child: GestureDetector(
                            onTap: () => setState(() => _photos.removeAt(index)),
                            child: const CircleAvatar(radius: 10, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white)),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _captionController,
                maxLength: 500,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Caption (optional)', border: OutlineInputBorder()),
              ),
              SegmentedButton<VideoVisibility>(
                segments: const [
                  ButtonSegment(value: VideoVisibility.public, label: Text('Public'), icon: Icon(Icons.public)),
                  ButtonSegment(value: VideoVisibility.private, label: Text('Private'), icon: Icon(Icons.lock_outline)),
                ],
                selected: {_visibility},
                onSelectionChanged: (selection) => setState(() => _visibility = selection.first),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
