/// A real, licensed track from Epidemic Sound's Partner Content API (see
/// backend's lib/epidemicSound.ts) — never a fabricated catalog row.
class EpidemicTrackModel {
  const EpidemicTrackModel({
    required this.id,
    required this.title,
    required this.artist,
    this.lengthSeconds,
    this.coverImageUrl,
  });

  factory EpidemicTrackModel.fromJson(Map<String, dynamic> json) {
    return EpidemicTrackModel(
      id: json['id'] as String,
      title: json['title'] as String,
      artist: json['artist'] as String,
      lengthSeconds: json['lengthSeconds'] as int?,
      coverImageUrl: json['coverImageUrl'] as String?,
    );
  }

  final String id;
  final String title;
  final String artist;
  final int? lengthSeconds;
  final String? coverImageUrl;

  String get durationLabel {
    final seconds = lengthSeconds;
    if (seconds == null) return '';
    final minutes = seconds ~/ 60;
    final remaining = seconds % 60;
    return '$minutes:${remaining.toString().padLeft(2, '0')}';
  }
}

class EpidemicTrackPage {
  const EpidemicTrackPage({required this.tracks, this.nextOffset});
  factory EpidemicTrackPage.fromJson(Map<String, dynamic> json) {
    return EpidemicTrackPage(
      tracks: (json['tracks'] as List).map((t) => EpidemicTrackModel.fromJson(t as Map<String, dynamic>)).toList(),
      nextOffset: json['nextOffset'] as int?,
    );
  }
  final List<EpidemicTrackModel> tracks;
  final int? nextOffset;
}
