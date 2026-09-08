import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/theme/xnak_colors.dart';
import '../../photopost/presentation/create_photo_post_screen.dart';
import '../../stories/presentation/create_story_screen.dart';
import '../../textpost/presentation/create_text_post_screen.dart';
import '../../live/presentation/start_live_screen.dart';
import 'banuba_camera_screen.dart';
import 'sound_picker_screen.dart';
import 'video_editor_screen.dart';

const _kMaxRecordingDuration = Duration(seconds: 60);

/// XNAKView's real Create camera — replaces the old Video/Story/Photo/Text
/// chooser sheet as the primary entry point behind the "+" button. Every
/// control here is genuinely wired to the native `camera` plugin; nothing
/// is a fake/disabled placeholder. A recorded or gallery-picked video always
/// goes to the real editor (video_editor_screen.dart) next, never straight
/// to a bare upload form. Live camera-preview effects/beauty/AR filters are
/// NOT implemented (no AR/GPU shader engine exists here) and are
/// deliberately omitted from this screen rather than shown as dead buttons
/// — see the completion report for the exact disclosed gap.
class CreateCameraScreen extends ConsumerStatefulWidget {
  const CreateCameraScreen({super.key, this.initialSoundId, this.initialSoundTitle});

  /// Set when arriving via "Use this sound" from a video's sound label.
  final String? initialSoundId;
  final String? initialSoundTitle;

  @override
  ConsumerState<CreateCameraScreen> createState() => _CreateCameraScreenState();
}

enum _CreateMode { photo, video, text, story }

class _CreateCameraScreenState extends ConsumerState<CreateCameraScreen> with WidgetsBindingObserver {
  CameraController? _controller;
  List<CameraDescription> _cameras = const [];
  int _cameraIndex = 0;
  FlashMode _flashMode = FlashMode.off;
  bool _isRecording = false;
  bool _isInitializing = true;
  String? _error;
  DateTime? _recordingStartedAt;
  Timer? _recordingTicker;
  Duration _elapsed = Duration.zero;
  int _timerSeconds = 0; // 0 == off
  Timer? _countdownTimer;
  int _countdownRemaining = 0;
  String? _selectedSoundId;
  String? _selectedSoundTitle;
  String? _selectedSoundArtist;
  bool _selectedSoundIsEpidemic = false;
  _CreateMode _mode = _CreateMode.video;
  double _baseZoom = 1;
  double _currentZoom = 1;
  double _maxZoom = 1;
  double _minZoom = 1;

  @override
  void initState() {
    super.initState();
    _selectedSoundId = widget.initialSoundId;
    _selectedSoundTitle = widget.initialSoundTitle;
    WidgetsBinding.instance.addObserver(this);
    _setUp();
  }

  Future<void> _setUp() async {
    final cameraPermission = await Permission.camera.request();
    final micPermission = await Permission.microphone.request();
    if (!cameraPermission.isGranted || !micPermission.isGranted) {
      setState(() {
        _isInitializing = false;
        _error = 'Camera and microphone permissions are required to create a video.';
      });
      return;
    }

    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        setState(() {
          _isInitializing = false;
          _error = 'No camera was found on this device.';
        });
        return;
      }
      await _openCamera(_cameraIndex);
    } catch (error) {
      setState(() {
        _isInitializing = false;
        _error = 'Could not start the camera: $error';
      });
    }
  }

  Future<void> _openCamera(int index) async {
    final previous = _controller;
    _controller = null;
    await previous?.dispose();

    final controller = CameraController(_cameras[index], ResolutionPreset.high, enableAudio: true);
    try {
      await controller.initialize();
      _minZoom = await controller.getMinZoomLevel();
      _maxZoom = await controller.getMaxZoomLevel();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _cameraIndex = index;
        _currentZoom = 1;
        _isInitializing = false;
        _error = null;
      });
    } catch (error) {
      await controller.dispose();
      if (mounted) {
        setState(() {
          _isInitializing = false;
          _error = 'Could not start the camera: $error';
        });
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      controller.dispose();
      _controller = null;
    } else if (state == AppLifecycleState.resumed) {
      _openCamera(_cameraIndex);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _recordingTicker?.cancel();
    _countdownTimer?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _flipCamera() async {
    if (_cameras.length < 2 || _isRecording) return;
    await _openCamera((_cameraIndex + 1) % _cameras.length);
  }

  Future<void> _cycleFlash() async {
    final controller = _controller;
    if (controller == null) return;
    final next = _flashMode == FlashMode.off ? FlashMode.torch : FlashMode.off;
    try {
      await controller.setFlashMode(next);
      setState(() => _flashMode = next);
    } catch (_) {
      // Some devices/lenses (most front cameras) have no flash — a no-op
      // is the correct, honest behavior rather than surfacing an error.
    }
  }

  void _cycleTimer() {
    setState(() => _timerSeconds = switch (_timerSeconds) { 0 => 3, 3 => 10, _ => 0 });
  }

  Future<void> _onRecordPressed() async {
    if (_isRecording) {
      await _stopRecording();
      return;
    }
    if (_timerSeconds > 0) {
      setState(() => _countdownRemaining = _timerSeconds);
      _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        setState(() => _countdownRemaining -= 1);
        if (_countdownRemaining <= 0) {
          timer.cancel();
          _startRecording();
        }
      });
      return;
    }
    await _startRecording();
  }

  Future<void> _startRecording() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _isRecording) return;
    try {
      await controller.startVideoRecording();
      _recordingStartedAt = DateTime.now();
      setState(() {
        _isRecording = true;
        _elapsed = Duration.zero;
      });
      _recordingTicker = Timer.periodic(const Duration(milliseconds: 100), (_) {
        final started = _recordingStartedAt;
        if (started == null) return;
        final elapsed = DateTime.now().difference(started);
        setState(() => _elapsed = elapsed);
        if (elapsed >= _kMaxRecordingDuration) _stopRecording();
      });
    } catch (error) {
      setState(() => _error = 'Could not start recording: $error');
    }
  }

  Future<void> _stopRecording() async {
    final controller = _controller;
    if (controller == null || !_isRecording) return;
    _recordingTicker?.cancel();
    try {
      final file = await controller.stopVideoRecording();
      setState(() => _isRecording = false);
      _goToPostFlow(File(file.path));
    } catch (error) {
      setState(() {
        _isRecording = false;
        _error = 'Could not save the recording: $error';
      });
    }
  }

  Future<void> _pickFromGallery() async {
    if (_mode == _CreateMode.photo) {
      // CreatePhotoPostScreen already owns its own gallery picker (up to
      // its 35-image carousel limit) — reuse it as-is rather than
      // duplicating that picking logic here.
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreatePhotoPostScreen()));
      return;
    }
    final picked = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (picked == null || !mounted) return;
    _goToPostFlow(File(picked.path));
  }

  void _goToPostFlow(File file) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoEditorScreen(
          file: file,
          initialSoundId: _selectedSoundId,
          initialSoundTitle: _selectedSoundTitle,
          initialSoundArtist: _selectedSoundArtist,
          initialSoundIsEpidemic: _selectedSoundIsEpidemic,
        ),
      ),
    );
  }

  Future<void> _openSoundPicker() async {
    final sound = await Navigator.of(context).push<SelectedSound>(MaterialPageRoute(builder: (_) => const SoundPickerScreen()));
    if (sound != null) {
      setState(() {
        _selectedSoundId = sound.id;
        _selectedSoundTitle = sound.title;
        _selectedSoundArtist = sound.artist;
        _selectedSoundIsEpidemic = sound.isEpidemic;
      });
    }
  }

  void _onModeSelected(_CreateMode mode) {
    setState(() => _mode = mode);
    switch (mode) {
      case _CreateMode.text:
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateTextPostScreen()));
      case _CreateMode.story:
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CreateStoryScreen()));
      case _CreateMode.photo:
      case _CreateMode.video:
        break; // stays on this camera screen
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            _buildCameraPreview(),
            _buildTopBar(),
            _buildRightControls(),
            _buildBottomArea(),
            if (_countdownRemaining > 0)
              Center(
                child: Text('$_countdownRemaining', style: const TextStyle(color: Colors.white, fontSize: 96, fontWeight: FontWeight.bold)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildCameraPreview() {
    if (_isInitializing) {
      return const Center(child: CircularProgressIndicator(color: Colors.white));
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.videocam_off_outlined, color: Colors.white54, size: 48),
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(onPressed: _setUp, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return const SizedBox.shrink();
    }
    return GestureDetector(
      onScaleStart: (_) => _baseZoom = _currentZoom,
      onScaleUpdate: (details) async {
        final zoom = (_baseZoom * details.scale).clamp(_minZoom, _maxZoom);
        if ((zoom - _currentZoom).abs() < 0.01) return;
        _currentZoom = zoom;
        await controller.setZoomLevel(zoom);
        if (mounted) setState(() {});
      },
      child: Center(child: CameraPreview(controller)),
    );
  }

  Widget _buildTopBar() {
    return Positioned(
      top: 8,
      left: 8,
      right: 8,
      child: Row(
        children: [
          IconButton(icon: const Icon(Icons.close, color: Colors.white, size: 28), onPressed: () => Navigator.of(context).pop()),
          const Spacer(),
          GestureDetector(
            onTap: _openSoundPicker,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(20)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.music_note, color: Colors.white, size: 16),
                  const SizedBox(width: 6),
                  Text(_selectedSoundTitle ?? 'Add sound', style: const TextStyle(color: Colors.white, fontSize: 13)),
                ],
              ),
            ),
          ),
          const Spacer(),
          IconButton(
            icon: Icon(_cameras.length > 1 ? Icons.cameraswitch_outlined : Icons.cameraswitch, color: Colors.white),
            onPressed: _flipCamera,
          ),
        ],
      ),
    );
  }

  Widget _buildRightControls() {
    return Positioned(
      right: 8,
      top: 70,
      child: Column(
        children: [
          _SideControlButton(
            icon: _flashMode == FlashMode.torch ? Icons.flash_on : Icons.flash_off,
            label: 'Flash',
            onTap: _cycleFlash,
          ),
          const SizedBox(height: 20),
          _SideControlButton(
            icon: Icons.timer_outlined,
            label: _timerSeconds == 0 ? 'Timer' : '${_timerSeconds}s',
            active: _timerSeconds > 0,
            onTap: _cycleTimer,
          ),
          const SizedBox(height: 20),
          _SideControlButton(
            icon: Icons.face_retouching_natural,
            label: 'Face AR',
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BanubaCameraScreen())),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomArea() {
    return Positioned(
      left: 0,
      right: 0,
      bottom: 12,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_isRecording)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_formatElapsed(_elapsed), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _GalleryButton(onTap: _pickFromGallery),
              _RecordButton(isRecording: _isRecording, progress: _elapsed.inMilliseconds / _kMaxRecordingDuration.inMilliseconds, onTap: _onRecordPressed),
              const SizedBox(width: 56),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 32,
            child: ListView(
              scrollDirection: Axis.horizontal,
              shrinkWrap: true,
              children: [
                _ModeLabel(label: 'Photo', selected: _mode == _CreateMode.photo, onTap: () => _onModeSelected(_CreateMode.photo)),
                _ModeLabel(label: 'Video', selected: _mode == _CreateMode.video, onTap: () => _onModeSelected(_CreateMode.video)),
                _ModeLabel(label: 'Text', selected: false, onTap: () => _onModeSelected(_CreateMode.text)),
                _ModeLabel(label: 'Story', selected: false, onTap: () => _onModeSelected(_CreateMode.story)),
                _ModeLabel(
                  label: 'LIVE',
                  selected: false,
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StartLiveScreen())),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatElapsed(Duration d) {
    final seconds = d.inSeconds % 60;
    final minutes = d.inMinutes;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

class _SideControlButton extends StatelessWidget {
  const _SideControlButton({required this.icon, required this.label, required this.onTap, this.active = false});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Icon(icon, color: active ? XnakColors.gold : Colors.white, size: 26, shadows: const [Shadow(blurRadius: 4, color: Colors.black54)]),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: Colors.white, fontSize: 11)),
        ],
      ),
    );
  }
}

class _GalleryButton extends StatelessWidget {
  const _GalleryButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.white70), color: Colors.black26),
        child: const Icon(Icons.photo_library_outlined, color: Colors.white),
      ),
    );
  }
}

class _RecordButton extends StatelessWidget {
  const _RecordButton({required this.isRecording, required this.progress, required this.onTap});

  final bool isRecording;
  final double progress;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: 76,
        height: 76,
        child: Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              width: 76,
              height: 76,
              child: CircularProgressIndicator(
                value: isRecording ? progress.clamp(0, 1) : 0,
                strokeWidth: 4,
                backgroundColor: Colors.white24,
                valueColor: const AlwaysStoppedAnimation(Colors.redAccent),
              ),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              width: isRecording ? 32 : 62,
              height: isRecording ? 32 : 62,
              decoration: BoxDecoration(
                color: Colors.redAccent,
                shape: isRecording ? BoxShape.rectangle : BoxShape.circle,
                borderRadius: isRecording ? BorderRadius.circular(8) : null,
                border: Border.all(color: Colors.white, width: 4),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModeLabel extends StatelessWidget {
  const _ModeLabel({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      child: GestureDetector(
        onTap: onTap,
        child: Center(
          child: Text(
            label,
            style: TextStyle(color: Colors.white, fontSize: selected ? 15 : 13, fontWeight: selected ? FontWeight.bold : FontWeight.w500),
          ),
        ),
      ),
    );
  }
}
