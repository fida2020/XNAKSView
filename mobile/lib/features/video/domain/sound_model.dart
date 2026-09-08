import 'package:equatable/equatable.dart';

/// A browsable Sound (Step 6's "reuse this video's own audio" — see backend
/// `Sound` model). Not a licensed music catalog: every sound traces back to
/// a real XNAKView video's own audio track.
class SoundModel extends Equatable {
  const SoundModel({required this.id, required this.title, required this.usageCount, this.authorLabel});

  factory SoundModel.fromJson(Map<String, dynamic> json) {
    final author = json['author'] as Map<String, dynamic>?;
    return SoundModel(
      id: json['id'] as String,
      title: json['title'] as String,
      usageCount: json['usageCount'] as int,
      authorLabel: author != null ? (author['displayName'] as String? ?? author['username'] as String?) : null,
    );
  }

  final String id;
  final String title;
  final int usageCount;
  final String? authorLabel;

  @override
  List<Object?> get props => [id, title, usageCount];
}
