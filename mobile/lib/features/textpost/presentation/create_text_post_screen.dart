import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import 'text_post_providers.dart';

const _backgroundStyles = <String, Color>{
  'plain': Colors.black,
  'gradient-1': Color(0xFF6A11CB),
  'gradient-2': Color(0xFFEF3B36),
  'gradient-3': Color(0xFF1D976C),
};

/// Text post creation (Step 6, brief B) — a caption-only post with a named
/// background preset, matching "do not store presentation-only client data
/// unnecessarily" (only the preset key is persisted, not raw styling data).
class CreateTextPostScreen extends ConsumerStatefulWidget {
  const CreateTextPostScreen({super.key});

  @override
  ConsumerState<CreateTextPostScreen> createState() => _CreateTextPostScreenState();
}

class _CreateTextPostScreenState extends ConsumerState<CreateTextPostScreen> {
  final _controller = TextEditingController();
  String _style = 'plain';
  bool _isSubmitting = false;

  Future<void> _submit() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      await ref.read(textPostRepositoryProvider).create(text: text, backgroundStyle: _style);
      if (mounted) Navigator.of(context).pop(true);
    } on AppException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundStyles[_style],
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        actions: [
          TextButton(
            onPressed: _isSubmitting ? null : _submit,
            child: Text('Post', style: TextStyle(color: Theme.of(context).colorScheme.inversePrimary)),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Expanded(
                child: Center(
                  child: TextField(
                    controller: _controller,
                    maxLength: 1000,
                    maxLines: null,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 24),
                    decoration: const InputDecoration(hintText: 'Start typing…', hintStyle: TextStyle(color: Colors.white70), border: InputBorder.none, counterStyle: TextStyle(color: Colors.white54)),
                  ),
                ),
              ),
              SizedBox(
                height: 48,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    for (final entry in _backgroundStyles.entries)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: GestureDetector(
                          onTap: () => setState(() => _style = entry.key),
                          child: CircleAvatar(
                            backgroundColor: entry.value,
                            child: _style == entry.key ? const Icon(Icons.check, color: Colors.white) : null,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
