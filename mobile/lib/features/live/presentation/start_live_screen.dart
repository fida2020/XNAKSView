import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors/app_exception.dart';
import 'live_host_screen.dart';
import 'live_providers.dart';

class StartLiveScreen extends ConsumerStatefulWidget {
  const StartLiveScreen({super.key});

  @override
  ConsumerState<StartLiveScreen> createState() => _StartLiveScreenState();
}

class _StartLiveScreenState extends ConsumerState<StartLiveScreen> {
  final _titleController = TextEditingController();
  final _categoryController = TextEditingController();
  File? _thumbnail;
  bool _isStarting = false;
  String? _error;

  Future<void> _pickThumbnail() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1080);
    if (picked != null) setState(() => _thumbnail = File(picked.path));
  }

  Future<void> _start() async {
    if (_titleController.text.trim().isEmpty) {
      setState(() => _error = 'Give your stream a title');
      return;
    }

    setState(() {
      _isStarting = true;
      _error = null;
    });

    try {
      final result = await ref.read(liveRepositoryProvider).startLive(
            title: _titleController.text.trim(),
            category: _categoryController.text.trim(),
            thumbnail: _thumbnail,
          );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => LiveHostScreen(liveSession: result.liveSession, connection: result.connection),
        ),
      );
    } on AppException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _categoryController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Go LIVE')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _titleController,
                maxLength: 100,
                decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder()),
              ),
              TextField(
                controller: _categoryController,
                maxLength: 50,
                decoration: const InputDecoration(labelText: 'Category (optional)', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _pickThumbnail,
                icon: const Icon(Icons.image_outlined),
                label: Text(_thumbnail == null ? 'Add a thumbnail (optional)' : 'Thumbnail selected'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _isStarting ? null : _start,
                child: _isStarting
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Start LIVE'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
