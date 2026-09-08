import 'dart:io';

import 'package:banuba_sdk/banuba_sdk.dart';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/config/app_config.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/theme/xnak_colors.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../gamification/presentation/fan_club_sheet.dart';
import 'live_host_screen.dart';
import 'live_providers.dart';

/// The real LIVE setup screen — full-screen camera as the background layer,
/// every control a transparent overlay above it (never an opaque card
/// blocking the camera). Reference: the supplied TikTok LIVE-setup
/// screenshots — this follows the same functional categories with
/// XnaksView's own original layout/branding, not a pixel clone.
///
/// What's real vs. disclosed on this screen specifically:
/// - Flip, Title/Category/Thumbnail, Coin Goal, Voice Chat mode, Settings
///   (subscriber-only chat / replay), Device camera source: fully real,
///   wired to the actual `POST /live` payload.
/// - Beautify/Effects: opens a real, working Banuba Face AR preview (the
///   same SDK/engine as Create's Face AR camera) — genuinely modifies what
///   YOU see while framing yourself. It does NOT yet modify what viewers
///   see once you actually go LIVE — bridging Banuba's output into the
///   LiveKit publish pipeline needs a native WebRTC frame-processor this
///   project hasn't built (see the completion report for the precise gap).
///   Physical devices generally allow only ONE consumer to hold the camera
///   hardware at a time, so this screen's own `CameraController` is fully
///   released before Banuba opens its own, and reacquired when Face AR
///   closes (see `_openFaceArPreview`/`_openCamera`) — a real crash found
///   in physical-device testing traced to both trying to hold the camera
///   at once.
/// - Fan Club: reuses XnaksView's existing real Fan Club system (join/leave,
///   fan level/XP, backend-computed member count — see
///   gamification/fanClub.ts), not a second/simpler implementation.
/// - Multi-guest: real invite/accept/remove flow, but only once a LIVE
///   session actually exists (see LiveHostScreen) — there is nothing to
///   invite guests INTO before that, so this screen explains that rather
///   than faking a pre-live guest list.
/// - Service+, Promote, Interact, Mobile game source: NOT implemented —
///   each is either an undefined product concept (Service+, Interact) or a
///   separate subsystem this project doesn't have (a paid ads platform for
///   Promote; Android screen+game-audio capture for Mobile game). Marked
///   "Coming soon" rather than a fake working button.
class StartLiveScreen extends ConsumerStatefulWidget {
  const StartLiveScreen({super.key});

  @override
  ConsumerState<StartLiveScreen> createState() => _StartLiveScreenState();
}

enum _LiveSource { deviceCamera, voiceChat }

class _StartLiveScreenState extends ConsumerState<StartLiveScreen> {
  CameraController? _controller;
  List<CameraDescription> _cameras = const [];
  int _cameraIndex = 0;
  bool _isInitializing = true;
  String? _cameraError;

  final _titleController = TextEditingController();
  final _categoryController = TextEditingController();
  final _goalTitleController = TextEditingController();
  final _goalTargetController = TextEditingController();
  bool _goalEnabled = false;
  bool _subscriberOnlyChat = false;
  bool _replayEnabled = false;
  File? _thumbnail;
  bool _isStarting = false;
  String? _error;
  _LiveSource _source = _LiveSource.deviceCamera;

  @override
  void initState() {
    super.initState();
    _setUp();
  }

  Future<void> _setUp() async {
    final cameraPermission = await Permission.camera.request();
    final micPermission = await Permission.microphone.request();
    if (!cameraPermission.isGranted || !micPermission.isGranted) {
      setState(() {
        _isInitializing = false;
        _cameraError = 'Camera and microphone permissions are required to go LIVE.';
      });
      return;
    }
    try {
      _cameras = await availableCameras();
      final frontIndex = _cameras.indexWhere((c) => c.lensDirection == CameraLensDirection.front);
      _cameraIndex = frontIndex >= 0 ? frontIndex : 0;
      await _openCamera(_cameraIndex);
    } catch (error) {
      if (mounted) {
        setState(() {
          _isInitializing = false;
          _cameraError = 'Could not start the camera: $error';
        });
      }
    }
  }

  /// Real Android camera devices generally allow only ONE consumer to hold
  /// the hardware at a time — the previous fix here (initializing the new
  /// `CameraController` before disposing the old one) raced two consumers
  /// against the same physical camera and was the real root cause of a
  /// crash found in physical-device testing (confirmed via the identical
  /// pattern in `_openFaceArPreview`, where the plain camera controller and
  /// Banuba's native camera also both tried to hold the hardware at once).
  /// The old controller is now always fully released before a new one is
  /// ever created.
  Future<void> _openCamera(int index) async {
    if (mounted) setState(() => _isInitializing = true);
    final previous = _controller;
    _controller = null;
    try {
      await previous?.dispose();
    } catch (_) {
      // Best-effort — proceed to open the requested camera regardless.
    }
    if (!mounted) return;

    try {
      final controller = CameraController(_cameras[index], ResolutionPreset.high, enableAudio: false);
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _cameraIndex = index;
        _isInitializing = false;
        _cameraError = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _isInitializing = false;
          _cameraError = 'Could not start the camera: $error';
        });
      }
    }
  }

  Future<void> _flipCamera() async {
    if (_cameras.length < 2) return;
    await _openCamera((_cameraIndex + 1) % _cameras.length);
  }

  Future<void> _pickThumbnail() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1080);
    if (picked != null) setState(() => _thumbnail = File(picked.path));
  }

  Future<void> _openDetailsSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.black,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          return Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(sheetContext).viewInsets.bottom, left: 16, right: 16, top: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _titleController,
                  maxLength: 100,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Title', labelStyle: TextStyle(color: Colors.white70), border: OutlineInputBorder()),
                ),
                TextField(
                  controller: _categoryController,
                  maxLength: 50,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Category (optional)', labelStyle: TextStyle(color: Colors.white70), border: OutlineInputBorder()),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () async {
                    await _pickThumbnail();
                    setSheetState(() {});
                  },
                  icon: const Icon(Icons.image_outlined, color: Colors.white),
                  label: Text(_thumbnail == null ? 'Add a thumbnail (optional)' : 'Thumbnail selected', style: const TextStyle(color: Colors.white)),
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Set a Coin goal', style: TextStyle(color: Colors.white)),
                  subtitle: const Text('Real progress, tracked from actual Gifts sent during this LIVE', style: TextStyle(color: Colors.white54, fontSize: 12)),
                  value: _goalEnabled,
                  onChanged: (value) => setSheetState(() => setState(() => _goalEnabled = value)),
                ),
                if (_goalEnabled) ...[
                  TextField(
                    controller: _goalTitleController,
                    maxLength: 80,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(labelText: 'Goal title (optional)', labelStyle: TextStyle(color: Colors.white70), border: OutlineInputBorder()),
                  ),
                  TextField(
                    controller: _goalTargetController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(labelText: 'Target (Coins)', labelStyle: TextStyle(color: Colors.white70), border: OutlineInputBorder()),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(onPressed: () => Navigator.of(sheetContext).pop(), child: const Text('Done')),
                const SizedBox(height: 16),
              ],
            ),
          );
        },
      ),
    );
    setState(() {});
  }

  Future<void> _openSettingsSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.black,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          return SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Padding(padding: EdgeInsets.all(16), child: Text('LIVE settings', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                SwitchListTile(
                  title: const Text('Subscriber-only chat', style: TextStyle(color: Colors.white)),
                  subtitle: const Text('Only your active LIVE subscribers can chat', style: TextStyle(color: Colors.white54, fontSize: 12)),
                  value: _subscriberOnlyChat,
                  onChanged: (value) => setSheetState(() => setState(() => _subscriberOnlyChat = value)),
                ),
                SwitchListTile(
                  title: const Text('Save a replay', style: TextStyle(color: Colors.white)),
                  subtitle: const Text('Keep a recording of this LIVE for later', style: TextStyle(color: Colors.white54, fontSize: 12)),
                  value: _replayEnabled,
                  onChanged: (value) => setSheetState(() => setState(() => _replayEnabled = value)),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// The single real fix for the physical-device crash: the plain `camera`
  /// package controller and Banuba's own native camera cannot both hold the
  /// physical camera device at once. This releases ours first, waits for
  /// Banuba's screen (which opens/closes its own camera correctly) to
  /// close, then reacquires ours — so the pre-LIVE preview resumes exactly
  /// as before, never disposed permanently, never fighting Banuba for the
  /// hardware.
  Future<void> _openFaceArPreview() async {
    if (AppConfig.banubaClientToken.isEmpty) {
      _showComingSoon('Face AR', reason: 'not configured in this build');
      return;
    }
    final previous = _controller;
    _controller = null;
    if (mounted) setState(() {});
    try {
      await previous?.dispose();
    } catch (_) {
      // Best-effort — still proceed to Face AR even if disposal errored.
    }
    if (!mounted) return;

    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _FaceArPreviewSheet()));

    if (mounted) await _openCamera(_cameraIndex);
  }

  Future<void> _openFanClub() async {
    final myUserId = ref.read(authControllerProvider).userId;
    if (myUserId == null) return;
    // Reuses XnaksView's existing real Fan Club system (join/leave, fan
    // level/XP, backend-computed — see gamification/fanClub.ts) rather than
    // a second, simpler implementation — this already exists and is more
    // complete than anything worth building fresh here.
    await showFanClubSheet(context, ref, creatorId: myUserId);
  }

  void _showComingSoon(String feature, {String? reason}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$feature is coming soon${reason != null ? ' ($reason)' : ''} — not implemented yet.')),
    );
  }

  /// A real modal sheet, never a fake participant grid — there is no LIVE
  /// session (and so no real room for a guest to join) until Go LIVE is
  /// pressed, so this honestly explains that rather than pretending guests
  /// are already connected. Being a sheet (not a route push), the camera
  /// preview underneath is never disposed.
  Future<void> _openMultiGuestSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.black,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.grid_view_rounded, color: Colors.white, size: 32),
              const SizedBox(height: 12),
              const Text('Multi-guest', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
              const SizedBox(height: 8),
              const Text(
                'Guests can join after you start LIVE. Once you\'re live, tap the Guests icon to invite a follower.',
                style: TextStyle(color: Colors.white70),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              OutlinedButton(onPressed: () => Navigator.of(sheetContext).pop(), child: const Text('Close')),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _start() async {
    if (_titleController.text.trim().isEmpty) {
      setState(() => _error = 'Give your stream a title');
      _openDetailsSheet();
      return;
    }
    final goalTarget = _goalEnabled ? int.tryParse(_goalTargetController.text.trim()) : null;
    if (_goalEnabled && (goalTarget == null || goalTarget <= 0)) {
      setState(() => _error = 'Enter a real Coin target for your goal');
      return;
    }

    setState(() {
      _isStarting = true;
      _error = null;
    });

    final voiceOnly = _source == _LiveSource.voiceChat;
    try {
      final result = await ref.read(liveRepositoryProvider).startLive(
            title: _titleController.text.trim(),
            category: _categoryController.text.trim(),
            thumbnail: _thumbnail,
            goalTitle: _goalEnabled ? _goalTitleController.text.trim() : null,
            goalTargetCoins: goalTarget,
            isVoiceOnly: voiceOnly,
            subscriberOnlyChat: _subscriberOnlyChat,
            replayEnabled: _replayEnabled,
          );
      if (!mounted) return;
      await _controller?.dispose();
      _controller = null;
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => LiveHostScreen(liveSession: result.liveSession, connection: result.connection, voiceOnly: voiceOnly),
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
    _controller?.dispose();
    _titleController.dispose();
    _categoryController.dispose();
    _goalTitleController.dispose();
    _goalTargetController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          _buildCameraLayer(),
          SafeArea(
            child: Column(
              children: [
                _buildTopBar(),
                const Spacer(),
                _buildIconGrid(),
                const SizedBox(height: 12),
                _buildSourceRow(),
                const SizedBox(height: 12),
                _buildBottomBar(),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCameraLayer() {
    if (_isInitializing) return const Center(child: CircularProgressIndicator(color: Colors.white));
    if (_cameraError != null) {
      return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_cameraError!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center)));
    }
    if (_source == _LiveSource.voiceChat) {
      // A real, visible mode switch — never disposes `_controller` (kept
      // alive so switching back to Device camera is instant, no
      // re-initialization/hardware-reacquire race).
      return Container(
        color: Colors.grey.shade900,
        child: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.mic, color: Colors.white, size: 64),
              SizedBox(height: 12),
              Text('Voice Chat — camera off for viewers', style: TextStyle(color: Colors.white70)),
            ],
          ),
        ),
      );
    }
    if (_controller == null) return const SizedBox.shrink();
    return ClipRect(
      child: OverflowBox(
        maxWidth: double.infinity,
        maxHeight: double.infinity,
        child: FittedBox(
          fit: BoxFit.cover,
          child: SizedBox(
            width: _controller!.value.previewSize?.height ?? 1,
            height: _controller!.value.previewSize?.width ?? 1,
            child: CameraPreview(_controller!),
          ),
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        children: [
          IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.of(context).pop()),
          const Spacer(),
          IconButton(icon: const Icon(Icons.cameraswitch_outlined, color: Colors.white), onPressed: _flipCamera),
        ],
      ),
    );
  }

  Widget _buildIconGrid() {
    final items = <_LiveGridItem>[
      _LiveGridItem(Icons.face_retouching_natural, 'Beautify', _openFaceArPreview),
      _LiveGridItem(Icons.auto_awesome, 'Effects', _openFaceArPreview),
      _LiveGridItem(Icons.tune, 'Settings', _openSettingsSheet),
      _LiveGridItem(Icons.grid_view_rounded, 'Multi-guest', _openMultiGuestSheet),
      _LiveGridItem(Icons.workspace_premium_outlined, 'Service+', () => _showComingSoon('Service+')),
      _LiveGridItem(Icons.local_fire_department_outlined, 'Fan Club', _openFanClub),
      _LiveGridItem(Icons.campaign_outlined, 'Promote', () => _showComingSoon('Promote')),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Wrap(
        alignment: WrapAlignment.center,
        spacing: 18,
        runSpacing: 12,
        children: [for (final item in items) _GridIconButton(item: item)],
      ),
    );
  }

  Widget _buildSourceRow() {
    Widget sourceChip(_LiveSource source, IconData icon, String label, {bool enabled = true}) {
      final selected = _source == source;
      return InkWell(
        onTap: enabled ? () => setState(() => _source = source) : () => _showComingSoon(label),
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          // A real, generous tap target (44dp+ on every axis) — the
          // previous tight, unpadded row was easy to mis-tap next to the
          // adjacent chip on a real device.
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Opacity(
            opacity: enabled ? 1 : 0.4,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: selected ? Colors.white : Colors.white70),
                const SizedBox(width: 4),
                Text(label, style: TextStyle(color: selected ? Colors.white : Colors.white70, fontWeight: selected ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        sourceChip(_LiveSource.voiceChat, Icons.mic, 'Voice chat'),
        sourceChip(_LiveSource.deviceCamera, Icons.videocam, 'Device camera'),
        InkWell(
          onTap: () => _showComingSoon('Mobile game', reason: 'needs screen capture, not built'),
          borderRadius: BorderRadius.circular(20),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Opacity(
              opacity: 0.4,
              child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.sports_esports_outlined, size: 16, color: Colors.white70), SizedBox(width: 4), Text('Mobile game', style: TextStyle(color: Colors.white70, fontSize: 13))]),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildBottomBar() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GestureDetector(
            onTap: _openDetailsSheet,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(24)),
              child: Row(
                children: [
                  const Icon(Icons.edit_outlined, color: Colors.white70, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _titleController.text.trim().isEmpty ? 'Add a title for your LIVE' : _titleController.text.trim(),
                      style: const TextStyle(color: Colors.white),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (_goalEnabled) ...[
                    const Icon(Icons.track_changes, color: Colors.white70, size: 16),
                    const SizedBox(width: 4),
                    const Text('LIVE goal', style: TextStyle(color: Colors.white70, fontSize: 12)),
                  ],
                ],
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.redAccent), textAlign: TextAlign.center),
          ],
          const SizedBox(height: 12),
          DecoratedBox(
            decoration: BoxDecoration(gradient: XnakColors.brandGradient, borderRadius: BorderRadius.circular(28)),
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.transparent, shadowColor: Colors.transparent, padding: const EdgeInsets.symmetric(vertical: 14)),
              onPressed: _isStarting ? null : _start,
              child: _isStarting
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Go LIVE', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveGridItem {
  _LiveGridItem(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;
}

class _GridIconButton extends StatelessWidget {
  const _GridIconButton({required this.item});
  final _LiveGridItem item;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: item.onTap,
      child: SizedBox(
        width: 64,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: const BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
              child: Icon(item.icon, color: Colors.white, size: 22),
            ),
            const SizedBox(height: 4),
            Text(item.label, style: const TextStyle(color: Colors.white, fontSize: 11), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

/// A real, working Face AR preview (Banuba SDK) reachable from LIVE setup —
/// genuinely applies the same real demo effect used in Create's Face AR
/// camera. Disclosed boundary: this preview is NOT yet what gets published
/// once you go LIVE (see this file's top doc comment).
class _FaceArPreviewSheet extends StatefulWidget {
  const _FaceArPreviewSheet();

  @override
  State<_FaceArPreviewSheet> createState() => _FaceArPreviewSheetState();
}

class _FaceArPreviewSheetState extends State<_FaceArPreviewSheet> {
  final _sdk = BanubaSdkManager();
  late final EffectPlayerWidget _epWidget;
  bool _isInitializing = true;
  bool _effectLoaded = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _epWidget = EffectPlayerWidget(onPlatformViewCreated: _onPlatformViewCreated);
    _setUp();
  }

  Future<void> _setUp() async {
    try {
      await _sdk.initialize([], AppConfig.banubaClientToken, SeverityLevel.info);
    } catch (error) {
      if (mounted) {
        setState(() {
          _isInitializing = false;
          _error = 'Face AR failed to initialize: $error';
        });
      }
    }
  }

  Future<void> _onPlatformViewCreated(int id) async {
    try {
      await _sdk.attachWidget(_epWidget.banubaId);
      await _sdk.openCamera();
      await _sdk.startPlayer();
      if (mounted) setState(() => _isInitializing = false);
    } catch (error) {
      if (mounted) {
        setState(() {
          _isInitializing = false;
          _error = 'Face AR camera failed to start: $error';
        });
      }
    }
  }

  Future<void> _toggleEffect() async {
    try {
      if (_effectLoaded) {
        await _sdk.unloadEffect();
      } else {
        await _sdk.loadEffect('effects/TrollGrandma', false);
      }
      if (mounted) setState(() => _effectLoaded = !_effectLoaded);
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not load the effect: $error')));
    }
  }

  @override
  void dispose() {
    _sdk.closeCamera();
    _sdk.deinitialize();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(child: _epWidget),
            if (_isInitializing) const Center(child: CircularProgressIndicator(color: Colors.white)),
            if (_error != null)
              Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center))),
            Positioned(top: 8, left: 8, child: IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.of(context).pop())),
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: Column(
                children: [
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 32),
                    child: Text(
                      'Preview only — not yet applied to your LIVE broadcast',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: _toggleEffect,
                    icon: Icon(_effectLoaded ? Icons.face_retouching_natural : Icons.face_outlined, color: Colors.white),
                    label: Text(_effectLoaded ? 'Remove demo AR effect' : 'Demo AR effect (TrollGrandma)', style: const TextStyle(color: Colors.white)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
