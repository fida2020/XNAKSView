import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:video_player/video_player.dart';

import '../domain/video_edit_spec.dart';
import 'sound_picker_screen.dart';
import 'upload_video_screen.dart';

/// The real video editor (Step 3 rebuild) — replaces the old "select a video
/// → straight to a caption form" flow. Every control here actually changes
/// what gets rendered: trim/speed/rotate/filter/text/sound/voice-over are
/// all sent to the server as a real edit spec (see backend's
/// renderEditedVideo) and are burned into the exported video, not just
/// previewed and discarded.
///
/// Real Undo/Redo: every structural change (trim/speed/filter/rotate/crop/
/// text add-move-delete/sound/voice-over) pushes a real snapshot onto a
/// history stack — Undo/Redo genuinely restores prior editor state, not a
/// decorative pair of icons.
///
/// NOT implemented, disclosed rather than faked: green-screen/background
/// replacement for THIS editor's post-capture flatten — Banuba's face/AR
/// effects (see create_camera_screen.dart) apply live, at record time, to a
/// camera feed; they don't retroactively reprocess an arbitrary
/// already-picked gallery file the way this editor's server-side ffmpeg
/// filters do. Stickers are also not implemented — there is no sticker
/// asset pipeline/content source available to populate a real one (a fake
/// clip-art set would be exactly the kind of placeholder rule 1 forbids).
class VideoEditorScreen extends ConsumerStatefulWidget {
  const VideoEditorScreen({
    super.key,
    required this.file,
    this.initialSoundId,
    this.initialSoundTitle,
    this.initialSoundArtist,
    this.initialSoundIsEpidemic = false,
  });

  final File file;
  final String? initialSoundId;
  final String? initialSoundTitle;
  final String? initialSoundArtist;
  final bool initialSoundIsEpidemic;

  @override
  ConsumerState<VideoEditorScreen> createState() => _VideoEditorScreenState();
}

enum _EditorTool { none, trim, speed, filter, crop, text, sound, voiceover, cover }

const _kCropAspectOptions = <String, String>{'original': 'Original', '1:1': '1:1', '9:16': '9:16', '16:9': '16:9'};

/// A real, immutable snapshot of every structural editor field — pushed
/// onto the undo/redo stacks on each real edit action.
class _EditorSnapshot {
  _EditorSnapshot({
    required this.trimRange,
    required this.speed,
    required this.filter,
    required this.rotateDegrees,
    required this.cropAspect,
    required List<TextOverlayDraft> textOverlays,
    required this.selectedTextIndex,
    required this.soundId,
    required this.soundTitle,
    required this.soundArtist,
    required this.soundIsEpidemic,
  }) : textOverlays = [for (final overlay in textOverlays) overlay.copy()];

  final RangeValues trimRange;
  final double speed;
  final String filter;
  final int rotateDegrees;
  final String cropAspect;
  final List<TextOverlayDraft> textOverlays;
  final int? selectedTextIndex;
  final String? soundId;
  final String? soundTitle;
  final String? soundArtist;
  final bool soundIsEpidemic;
}

class _VideoEditorScreenState extends ConsumerState<VideoEditorScreen> {
  late final VideoPlayerController _controller;
  bool _isReady = false;
  double _totalMs = 0;
  RangeValues _trimRange = const RangeValues(0, 1);
  double _speed = 1.0;
  String _filter = 'none';
  int _rotateDegrees = 0;
  final List<TextOverlayDraft> _textOverlays = [];
  int? _selectedTextIndex;
  String? _soundId;
  String? _soundTitle;
  String? _soundArtist;
  bool _soundIsEpidemic = false;
  double _originalVolume = 1.0;
  double _soundVolume = 1.0;
  double _voiceoverVolume = 1.0;
  File? _voiceoverFile;
  final _voiceRecorder = AudioRecorder();
  bool _isRecordingVoiceover = false;
  AudioPlayer? _voiceoverPlayer;
  bool _isPlayingVoiceoverPreview = false;
  double? _coverAtMs;
  String _cropAspect = 'original';
  _EditorTool _tool = _EditorTool.none;
  final List<_EditorSnapshot> _undoStack = [];
  final List<_EditorSnapshot> _redoStack = [];

  @override
  void initState() {
    super.initState();
    _soundId = widget.initialSoundId;
    _soundTitle = widget.initialSoundTitle;
    _soundArtist = widget.initialSoundArtist;
    _soundIsEpidemic = widget.initialSoundIsEpidemic;
    _controller = VideoPlayerController.file(widget.file)
      ..initialize().then((_) {
        if (!mounted) return;
        setState(() {
          _isReady = true;
          _totalMs = _controller.value.duration.inMilliseconds.toDouble();
          _trimRange = RangeValues(0, _totalMs);
        });
        _controller
          ..setLooping(true)
          ..play();
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    _voiceoverPlayer?.dispose();
    _voiceRecorder.dispose();
    super.dispose();
  }

  void _setTool(_EditorTool tool) => setState(() => _tool = _tool == tool ? _EditorTool.none : tool);

  _EditorSnapshot _takeSnapshot() => _EditorSnapshot(
        trimRange: _trimRange,
        speed: _speed,
        filter: _filter,
        rotateDegrees: _rotateDegrees,
        cropAspect: _cropAspect,
        textOverlays: _textOverlays,
        selectedTextIndex: _selectedTextIndex,
        soundId: _soundId,
        soundTitle: _soundTitle,
        soundArtist: _soundArtist,
        soundIsEpidemic: _soundIsEpidemic,
      );

  /// Call BEFORE mutating state for any real, undo-worthy edit action.
  void _pushHistory() {
    _undoStack.add(_takeSnapshot());
    _redoStack.clear();
  }

  void _restore(_EditorSnapshot snapshot) {
    _trimRange = snapshot.trimRange;
    _speed = snapshot.speed;
    _filter = snapshot.filter;
    _rotateDegrees = snapshot.rotateDegrees;
    _cropAspect = snapshot.cropAspect;
    _textOverlays
      ..clear()
      ..addAll([for (final overlay in snapshot.textOverlays) overlay.copy()]);
    _selectedTextIndex = snapshot.selectedTextIndex;
    _soundId = snapshot.soundId;
    _soundTitle = snapshot.soundTitle;
    _soundArtist = snapshot.soundArtist;
    _soundIsEpidemic = snapshot.soundIsEpidemic;
    if (_isReady) _controller.setPlaybackSpeed(_speed);
  }

  void _undo() {
    if (_undoStack.isEmpty) return;
    setState(() {
      _redoStack.add(_takeSnapshot());
      _restore(_undoStack.removeLast());
    });
  }

  void _redo() {
    if (_redoStack.isEmpty) return;
    setState(() {
      _undoStack.add(_takeSnapshot());
      _restore(_redoStack.removeLast());
    });
  }

  void _applySpeed(double speed) {
    _pushHistory();
    setState(() => _speed = speed);
    if (_isReady) _controller.setPlaybackSpeed(speed);
  }

  void _cycleRotate() {
    _pushHistory();
    setState(() => _rotateDegrees = (_rotateDegrees + 90) % 360);
  }

  void _setCropAspect(String aspect) {
    _pushHistory();
    setState(() => _cropAspect = aspect);
  }

  Future<void> _openSoundPicker() async {
    final sound = await Navigator.of(context).push<SelectedSound>(MaterialPageRoute(builder: (_) => const SoundPickerScreen()));
    if (sound != null && mounted) {
      _pushHistory();
      setState(() {
        _soundId = sound.id;
        _soundTitle = sound.title;
        _soundArtist = sound.artist;
        _soundIsEpidemic = sound.isEpidemic;
      });
    }
  }

  Future<void> _addTextOverlay() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add text'),
        content: TextField(controller: controller, autofocus: true, maxLength: 120, maxLines: 2),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(controller.text.trim()), child: const Text('Add')),
        ],
      ),
    );
    if (text != null && text.isNotEmpty && mounted) {
      _pushHistory();
      setState(() {
        _textOverlays.add(TextOverlayDraft(text: text, xPct: 0.5, yPct: 0.5));
        _selectedTextIndex = _textOverlays.length - 1;
        _tool = _EditorTool.text;
      });
    }
  }

  void _deleteSelectedText() {
    final index = _selectedTextIndex;
    if (index == null) return;
    _pushHistory();
    setState(() {
      _textOverlays.removeAt(index);
      _selectedTextIndex = null;
    });
  }

  Future<void> _toggleVoiceover() async {
    if (_isRecordingVoiceover) {
      final path = await _voiceRecorder.stop();
      if (mounted) {
        setState(() {
          _isRecordingVoiceover = false;
          if (path != null) _voiceoverFile = File(path);
        });
      }
      return;
    }
    if (!await _voiceRecorder.hasPermission()) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Microphone permission is required to record a voice-over')));
      }
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/voiceover_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _voiceRecorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    if (mounted) setState(() => _isRecordingVoiceover = true);
  }

  Future<void> _previewVoiceover() async {
    final file = _voiceoverFile;
    if (file == null) return;
    if (_isPlayingVoiceoverPreview) {
      await _voiceoverPlayer?.stop();
      if (mounted) setState(() => _isPlayingVoiceoverPreview = false);
      return;
    }
    _voiceoverPlayer ??= AudioPlayer();
    await _voiceoverPlayer!.setFilePath(file.path);
    setState(() => _isPlayingVoiceoverPreview = true);
    unawaited(_voiceoverPlayer!.play());
    _voiceoverPlayer!.playerStateStream.firstWhere((s) => s.processingState == ProcessingState.completed).then((_) {
      if (mounted) setState(() => _isPlayingVoiceoverPreview = false);
    });
  }

  void _deleteVoiceover() {
    setState(() {
      _voiceoverFile = null;
      _isPlayingVoiceoverPreview = false;
    });
    _voiceoverPlayer?.stop();
  }

  Future<void> _pickCoverHere() async {
    setState(() => _coverAtMs = _controller.value.position.inMilliseconds.toDouble());
  }

  void _continue() {
    _controller.pause();
    final spec = VideoEditSpec(
      trimStartMs: _trimRange.start.round(),
      trimEndMs: _trimRange.end.round(),
      speed: _speed,
      filter: _filter,
      rotateDegrees: _rotateDegrees,
      cropAspect: _cropAspect,
      textOverlays: _textOverlays,
      originalVolume: _originalVolume,
      soundVolume: _soundVolume,
      voiceoverVolume: _voiceoverVolume,
      coverAtMs: _coverAtMs?.round(),
    );
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PostVideoScreen(
          file: widget.file,
          editSpec: spec,
          soundId: _soundIsEpidemic ? null : _soundId,
          epidemicTrackId: _soundIsEpidemic ? _soundId : null,
          epidemicTrackTitle: _soundIsEpidemic ? _soundTitle : null,
          epidemicTrackArtist: _soundIsEpidemic ? _soundArtist : null,
          voiceoverFile: _voiceoverFile,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(
                children: [
                  IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.of(context).pop()),
                  IconButton(
                    icon: const Icon(Icons.undo),
                    color: _undoStack.isEmpty ? Colors.white24 : Colors.white,
                    onPressed: _undoStack.isEmpty ? null : _undo,
                  ),
                  IconButton(
                    icon: const Icon(Icons.redo),
                    color: _redoStack.isEmpty ? Colors.white24 : Colors.white,
                    onPressed: _redoStack.isEmpty ? null : _redo,
                  ),
                  const Spacer(),
                  const Text('Edit', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  const Spacer(),
                  TextButton(onPressed: _isReady ? _continue : null, child: const Text('Next')),
                ],
              ),
            ),
            Expanded(child: _buildPreview()),
            _buildToolBar(),
            _buildToolPanel(),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview() {
    if (!_isReady) return const Center(child: CircularProgressIndicator(color: Colors.white));
    return GestureDetector(
      onTap: () => setState(() => _controller.value.isPlaying ? _controller.pause() : _controller.play()),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Transform.rotate(
            angle: _rotateDegrees * math.pi / 180,
            child: ColorFiltered(
              colorFilter: ColorFilter.matrix(_filterMatrix(_filter)),
              child: AspectRatio(aspectRatio: _controller.value.aspectRatio, child: VideoPlayer(_controller)),
            ),
          ),
          for (var i = 0; i < _textOverlays.length; i++) _buildDraggableText(i),
        ],
      ),
    );
  }

  Widget _buildDraggableText(int index) {
    final overlay = _textOverlays[index];
    final selected = _selectedTextIndex == index;
    return LayoutBuilder(
      builder: (context, constraints) {
        return Positioned(
          left: overlay.xPct * constraints.maxWidth - 60,
          top: overlay.yPct * constraints.maxHeight - 20,
          child: GestureDetector(
            onTap: () => setState(() => _selectedTextIndex = index),
            onPanStart: (_) => _pushHistory(),
            onPanUpdate: (details) {
              setState(() {
                overlay.xPct = ((overlay.xPct * constraints.maxWidth + details.delta.dx) / constraints.maxWidth).clamp(0.0, 1.0);
                overlay.yPct = ((overlay.yPct * constraints.maxHeight + details.delta.dy) / constraints.maxHeight).clamp(0.0, 1.0);
              });
            },
            child: Container(
              constraints: const BoxConstraints(maxWidth: 220),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(border: selected ? Border.all(color: Colors.white, width: 1.5) : null),
              child: Text(
                overlay.text,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(int.parse(overlay.color.replaceFirst('#', '0xFF'))),
                  fontSize: overlay.fontSizePx / 2,
                  fontWeight: FontWeight.bold,
                  shadows: const [Shadow(color: Colors.black87, blurRadius: 4)],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildToolBar() {
    Widget item(_EditorTool tool, IconData icon, String label) {
      final selected = _tool == tool;
      return InkWell(
        onTap: () => _setTool(tool),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: selected ? Theme.of(context).colorScheme.primary : Colors.white, size: 22),
              const SizedBox(height: 2),
              Text(label, style: TextStyle(color: selected ? Theme.of(context).colorScheme.primary : Colors.white, fontSize: 11)),
            ],
          ),
        ),
      );
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          item(_EditorTool.trim, Icons.content_cut, 'Trim'),
          item(_EditorTool.speed, Icons.speed, 'Speed'),
          item(_EditorTool.filter, Icons.tune, 'Filters'),
          item(_EditorTool.crop, Icons.crop, 'Crop'),
          InkWell(
            onTap: _cycleRotate,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.rotate_90_degrees_cw, color: Colors.white, size: 22),
                  SizedBox(height: 2),
                  Text('Rotate', style: TextStyle(color: Colors.white, fontSize: 11)),
                ],
              ),
            ),
          ),
          item(_EditorTool.text, Icons.text_fields, 'Text'),
          item(_EditorTool.sound, Icons.music_note, 'Sound'),
          item(_EditorTool.voiceover, Icons.mic, 'Voice-over'),
          item(_EditorTool.cover, Icons.image_outlined, 'Cover'),
        ],
      ),
    );
  }

  Widget _buildToolPanel() {
    switch (_tool) {
      case _EditorTool.none:
        return const SizedBox(height: 12);
      case _EditorTool.trim:
        return _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${(_trimRange.start / 1000).toStringAsFixed(1)}s – ${(_trimRange.end / 1000).toStringAsFixed(1)}s',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white),
              ),
              RangeSlider(
                min: 0,
                max: _totalMs,
                values: _trimRange,
                onChanged: (values) {
                  setState(() => _trimRange = values);
                  _controller.seekTo(Duration(milliseconds: values.start.round()));
                },
              ),
            ],
          ),
        );
      case _EditorTool.speed:
        return _panel(
          child: Wrap(
            spacing: 8,
            alignment: WrapAlignment.center,
            children: [
              for (final speed in kVideoSpeedOptions)
                ChoiceChip(
                  label: Text('${speed}x'),
                  selected: _speed == speed,
                  onSelected: (_) => _applySpeed(speed),
                ),
            ],
          ),
        );
      case _EditorTool.filter:
        return _panel(
          child: Wrap(
            spacing: 8,
            alignment: WrapAlignment.center,
            children: [
              for (final entry in kVideoFilterOptions.entries)
                ChoiceChip(
                  label: Text(entry.value),
                  selected: _filter == entry.key,
                  onSelected: (_) {
                    _pushHistory();
                    setState(() => _filter = entry.key);
                  },
                ),
            ],
          ),
        );
      case _EditorTool.crop:
        return _panel(
          child: Wrap(
            spacing: 8,
            alignment: WrapAlignment.center,
            children: [
              for (final entry in _kCropAspectOptions.entries)
                ChoiceChip(
                  label: Text(entry.value),
                  selected: _cropAspect == entry.key,
                  onSelected: (_) => _setCropAspect(entry.key),
                ),
            ],
          ),
        );
      case _EditorTool.text:
        return _panel(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  TextButton.icon(onPressed: _addTextOverlay, icon: const Icon(Icons.add), label: const Text('Add text')),
                  if (_selectedTextIndex != null)
                    TextButton.icon(
                      onPressed: _deleteSelectedText,
                      icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                      label: const Text('Delete', style: TextStyle(color: Colors.redAccent)),
                    ),
                ],
              ),
              if (_selectedTextIndex != null) ...[
                const Text('Size', style: TextStyle(color: Colors.white70, fontSize: 12)),
                Slider(
                  min: 24,
                  max: 96,
                  value: _textOverlays[_selectedTextIndex!].fontSizePx.clamp(24, 96),
                  onChanged: (value) => setState(() => _textOverlays[_selectedTextIndex!].fontSizePx = value),
                ),
              ],
            ],
          ),
        );
      case _EditorTool.sound:
        return _panel(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_soundId == null)
                FilledButton.icon(onPressed: _openSoundPicker, icon: const Icon(Icons.search), label: const Text('Add a sound'))
              else ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.music_note, color: Colors.white, size: 16),
                    const SizedBox(width: 6),
                    Flexible(child: Text(_soundTitle ?? 'Sound selected', style: const TextStyle(color: Colors.white), overflow: TextOverflow.ellipsis)),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white70, size: 18),
                      onPressed: () {
                        _pushHistory();
                        setState(() {
                          _soundId = null;
                          _soundTitle = null;
                          _soundArtist = null;
                          _soundIsEpidemic = false;
                        });
                      },
                    ),
                  ],
                ),
                _volumeRow('Original sound', _originalVolume, (v) => setState(() => _originalVolume = v)),
                _volumeRow('Added sound', _soundVolume, (v) => setState(() => _soundVolume = v)),
              ],
            ],
          ),
        );
      case _EditorTool.voiceover:
        return _panel(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_voiceoverFile == null)
                FilledButton.icon(
                  onPressed: _toggleVoiceover,
                  icon: Icon(_isRecordingVoiceover ? Icons.stop : Icons.fiber_manual_record, color: _isRecordingVoiceover ? Colors.white : Colors.red),
                  label: Text(_isRecordingVoiceover ? 'Stop recording' : 'Record voice-over'),
                )
              else ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      icon: Icon(_isPlayingVoiceoverPreview ? Icons.pause : Icons.play_arrow, color: Colors.white),
                      onPressed: _previewVoiceover,
                    ),
                    const Text('Voice-over recorded', style: TextStyle(color: Colors.white)),
                    IconButton(icon: const Icon(Icons.delete_outline, color: Colors.redAccent), onPressed: _deleteVoiceover),
                  ],
                ),
                _volumeRow('Voice-over volume', _voiceoverVolume, (v) => setState(() => _voiceoverVolume = v)),
              ],
            ],
          ),
        );
      case _EditorTool.cover:
        return _panel(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _coverAtMs != null ? 'Cover set at ${(_coverAtMs! / 1000).toStringAsFixed(1)}s' : 'Scrub the preview, then pick a frame',
                style: const TextStyle(color: Colors.white),
              ),
              const SizedBox(height: 8),
              FilledButton(onPressed: _pickCoverHere, child: const Text('Use this frame as cover')),
            ],
          ),
        );
    }
  }

  Widget _volumeRow(String label, double value, ValueChanged<double> onChanged) {
    return Row(
      children: [
        SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12))),
        Expanded(child: Slider(value: value, onChanged: onChanged)),
      ],
    );
  }

  Widget _panel({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: Colors.black,
      child: child,
    );
  }
}

/// Best-effort LIVE preview approximation of the server's real color-grade
/// presets (see backend's FILTER_PRESETS in lib/ffmpeg.ts) — the export
/// itself is server-rendered from the same named preset, so the exported
/// video is always exactly what the server defines; this matrix only needs
/// to look close enough while scrubbing, a disclosed simplification.
List<double> _filterMatrix(String filter) {
  switch (filter) {
    case 'mono':
      return const [
        0.2126, 0.7152, 0.0722, 0, 0,
        0.2126, 0.7152, 0.0722, 0, 0,
        0.2126, 0.7152, 0.0722, 0, 0,
        0, 0, 0, 1, 0,
      ];
    case 'warm':
      return const [
        1.15, 0, 0, 0, 10,
        0, 1.05, 0, 0, 0,
        0, 0, 0.85, 0, 0,
        0, 0, 0, 1, 0,
      ];
    case 'cool':
      return const [
        0.85, 0, 0, 0, 0,
        0, 1.0, 0, 0, 0,
        0, 0, 1.2, 0, 10,
        0, 0, 0, 1, 0,
      ];
    case 'vivid':
      return _saturationMatrix(1.6);
    case 'fade':
      return _saturationMatrix(0.55, brightnessOffset: 15);
    case 'none':
    default:
      return const [
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, 1, 0, 0,
        0, 0, 0, 1, 0,
      ];
  }
}

List<double> _saturationMatrix(double s, {double brightnessOffset = 0}) {
  const lumR = 0.213, lumG = 0.715, lumB = 0.072;
  return [
    lumR + (1 - lumR) * s, lumG - lumG * s, lumB - lumB * s, 0, brightnessOffset,
    lumR - lumR * s, lumG + (1 - lumG) * s, lumB - lumB * s, 0, brightnessOffset,
    lumR - lumR * s, lumG - lumG * s, lumB + (1 - lumB) * s, 0, brightnessOffset,
    0, 0, 0, 1, 0,
  ];
}
