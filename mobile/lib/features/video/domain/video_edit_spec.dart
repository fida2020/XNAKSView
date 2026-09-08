/// One movable/resizable text overlay burned into the exported video by the
/// server (see backend's renderEditedVideo) — `xPct`/`yPct` are the center
/// point as a fraction (0-1) of the frame, matching how the editor preview
/// positions it, so the exported result lines up with what was previewed.
class TextOverlayDraft {
  TextOverlayDraft({required this.text, required this.xPct, required this.yPct, this.fontSizePx = 48, this.color = '#FFFFFF'});

  String text;
  double xPct;
  double yPct;
  double fontSizePx;
  String color;

  Map<String, dynamic> toJson() => {
        'text': text,
        'xPct': xPct,
        'yPct': yPct,
        'fontSizePx': fontSizePx.round(),
        'color': color,
      };

  TextOverlayDraft copy() => TextOverlayDraft(text: text, xPct: xPct, yPct: yPct, fontSizePx: fontSizePx, color: color);
}

/// The real edit spec applied server-side at render time (trim/speed/filter/
/// text/rotate/cover/volumes) — mirrors backend's videoEditSpecSchema
/// exactly; sent as JSON in the `edit` multipart field.
class VideoEditSpec {
  VideoEditSpec({
    this.trimStartMs,
    this.trimEndMs,
    this.speed = 1.0,
    this.filter = 'none',
    this.rotateDegrees = 0,
    this.cropAspect = 'original',
    List<TextOverlayDraft>? textOverlays,
    this.originalVolume = 1.0,
    this.soundVolume = 1.0,
    this.voiceoverVolume = 1.0,
    this.coverAtMs,
  }) : textOverlays = textOverlays ?? [];

  int? trimStartMs;
  int? trimEndMs;
  double speed;
  String filter;
  int rotateDegrees;
  String cropAspect;
  List<TextOverlayDraft> textOverlays;
  double originalVolume;
  double soundVolume;
  double voiceoverVolume;
  int? coverAtMs;

  Map<String, dynamic> toJson() => {
        if (trimStartMs != null) 'trimStartMs': trimStartMs,
        if (trimEndMs != null) 'trimEndMs': trimEndMs,
        'speed': speed,
        'filter': filter,
        'rotateDegrees': rotateDegrees,
        'cropAspect': cropAspect,
        'textOverlays': textOverlays.map((overlay) => overlay.toJson()).toList(),
        'originalVolume': originalVolume,
        'soundVolume': soundVolume,
        'voiceoverVolume': voiceoverVolume,
        if (coverAtMs != null) 'coverAtMs': coverAtMs,
      };
}

const kVideoFilterOptions = <String, String>{
  'none': 'Original',
  'mono': 'Mono',
  'warm': 'Warm',
  'cool': 'Cool',
  'vivid': 'Vivid',
  'fade': 'Fade',
};

const kVideoSpeedOptions = <double>[0.3, 0.5, 1.0, 1.5, 2.0, 3.0];
