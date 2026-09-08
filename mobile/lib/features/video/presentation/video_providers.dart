import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client_provider.dart';
import '../data/epidemic_sound_repository.dart';
import '../data/sound_repository.dart';
import '../data/video_repository.dart';

final videoRepositoryProvider = Provider<VideoRepository>((ref) {
  return VideoRepository(ref.watch(apiClientProvider));
});

final soundRepositoryProvider = Provider<SoundRepository>((ref) {
  return SoundRepository(ref.watch(apiClientProvider));
});

final epidemicSoundRepositoryProvider = Provider<EpidemicSoundRepository>((ref) {
  return EpidemicSoundRepository(ref.watch(apiClientProvider));
});
