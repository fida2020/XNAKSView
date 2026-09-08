import 'dart:io';

import 'package:banuba_sdk/banuba_sdk.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/config/app_config.dart';
import 'video_editor_screen.dart';

/// Real Face AR camera (Banuba SDK) — on-device face tracking/AR effects,
/// wired through the actual `BanubaSdkManager`/`EffectPlayerWidget` API
/// (not a fake preview). Recording goes through Banuba's own
/// `startVideoRecording`/`stopVideoRecording`, so a loaded effect is really
/// baked into the output file, then handed to the same real editor
/// (trim/speed/filter/sound/etc.) every other Create path uses.
///
/// Only ONE real effect is bundled ("TrollGrandma", Banuba's own demo AR
/// mask shipped with the SDK's example app) — there is no sticker/effects
/// marketplace integration here, so this is honestly labeled as a demo
/// effect rather than "Beautify". Real Beautify/Retouch and virtual
/// backgrounds need licensed effect asset files from Banuba's effects
/// marketplace, which this integration does not have.
class BanubaCameraScreen extends StatefulWidget {
  const BanubaCameraScreen({super.key});

  @override
  State<BanubaCameraScreen> createState() => _BanubaCameraScreenState();
}

class _BanubaCameraScreenState extends State<BanubaCameraScreen> {
  final _sdk = BanubaSdkManager();
  late final EffectPlayerWidget _epWidget;
  bool _isInitializing = true;
  bool _isFrontCamera = true;
  bool _effectLoaded = false;
  bool _isRecording = false;
  String? _recordingPath;
  String? _error;

  @override
  void initState() {
    super.initState();
    _epWidget = EffectPlayerWidget(onPlatformViewCreated: _onPlatformViewCreated);
    _setUp();
  }

  Future<void> _setUp() async {
    if (AppConfig.banubaClientToken.isEmpty) {
      setState(() {
        _isInitializing = false;
        _error = 'Face AR is not configured in this build (no BANUBA_CLIENT_TOKEN was set at build time).';
      });
      return;
    }
    final camera = await Permission.camera.request();
    final mic = await Permission.microphone.request();
    if (!camera.isGranted || !mic.isGranted) {
      setState(() {
        _isInitializing = false;
        _error = 'Camera and microphone permissions are required for Face AR.';
      });
      return;
    }
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

  Future<void> _flip() async {
    final front = !_isFrontCamera;
    try {
      await _sdk.setCameraFacing(front);
      if (mounted) setState(() => _isFrontCamera = front);
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not flip the camera: $error')));
    }
  }

  Future<void> _toggleRecording() async {
    if (_isRecording) {
      try {
        await _sdk.stopVideoRecording();
      } catch (error) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Recording failed: $error')));
        setState(() => _isRecording = false);
        return;
      }
      final path = _recordingPath;
      if (mounted) setState(() => _isRecording = false);
      if (path != null && mounted && File(path).existsSync()) {
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => VideoEditorScreen(file: File(path))));
      }
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/banuba_${DateTime.now().millisecondsSinceEpoch}.mp4';
    try {
      await _sdk.startVideoRecording(path, true, 720, 1280);
      _recordingPath = path;
      if (mounted) setState(() => _isRecording = true);
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not start recording: $error')));
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
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_error!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
                ),
              ),
            Positioned(
              top: 8,
              left: 8,
              right: 8,
              child: Row(
                children: [
                  IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.of(context).pop()),
                  const Spacer(),
                  IconButton(icon: const Icon(Icons.cameraswitch_outlined, color: Colors.white), onPressed: _flip),
                ],
              ),
            ),
            if (_error == null)
              Positioned(
                bottom: 24,
                left: 0,
                right: 0,
                child: Column(
                  children: [
                    TextButton.icon(
                      onPressed: _toggleEffect,
                      icon: Icon(_effectLoaded ? Icons.face_retouching_natural : Icons.face_outlined, color: Colors.white),
                      label: Text(
                        _effectLoaded ? 'Remove demo AR effect' : 'Demo AR effect (TrollGrandma)',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                    const SizedBox(height: 12),
                    GestureDetector(
                      onTap: _toggleRecording,
                      child: Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 4),
                          color: _isRecording ? Colors.red : Colors.transparent,
                        ),
                      ),
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
