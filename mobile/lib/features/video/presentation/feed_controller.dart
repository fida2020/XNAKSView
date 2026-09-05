import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../data/video_repository.dart';
import '../domain/video_model.dart';
import 'video_providers.dart';

enum FeedLoadStatus { initial, loading, loadingMore, loaded, error }

class FeedState extends Equatable {
  const FeedState({
    this.videos = const [],
    this.nextCursor,
    this.status = FeedLoadStatus.initial,
    this.errorMessage,
  });

  final List<VideoModel> videos;
  final String? nextCursor;
  final FeedLoadStatus status;
  final String? errorMessage;

  bool get hasMore => nextCursor != null;

  FeedState copyWith({
    List<VideoModel>? videos,
    String? nextCursor,
    bool clearCursor = false,
    FeedLoadStatus? status,
    String? errorMessage,
  }) {
    return FeedState(
      videos: videos ?? this.videos,
      nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
      status: status ?? this.status,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => [videos, nextCursor, status, errorMessage];
}

/// Drives a paginated list of videos — the main feed, or a single creator's
/// videos — sharing the same load-more/optimistic-engagement logic either way.
class FeedController extends StateNotifier<FeedState> {
  FeedController(this._repository, this._fetchPage) : super(const FeedState()) {
    loadInitial();
  }

  final VideoRepository _repository;
  final Future<FeedPage> Function({String? cursor}) _fetchPage;

  Future<void> loadInitial() async {
    state = state.copyWith(status: FeedLoadStatus.loading, errorMessage: null);
    try {
      final page = await _fetchPage();
      state = FeedState(videos: page.videos, nextCursor: page.nextCursor, status: FeedLoadStatus.loaded);
    } on AppException catch (error) {
      state = state.copyWith(status: FeedLoadStatus.error, errorMessage: error.message);
    }
  }

  Future<void> loadMore() async {
    if (state.status == FeedLoadStatus.loadingMore || !state.hasMore) return;
    state = state.copyWith(status: FeedLoadStatus.loadingMore);
    try {
      final page = await _fetchPage(cursor: state.nextCursor);
      state = state.copyWith(
        videos: [...state.videos, ...page.videos],
        nextCursor: page.nextCursor,
        clearCursor: page.nextCursor == null,
        status: FeedLoadStatus.loaded,
      );
    } on AppException catch (error) {
      state = state.copyWith(status: FeedLoadStatus.loaded, errorMessage: error.message);
    }
  }

  void _replaceVideo(String videoId, VideoModel Function(VideoModel) update) {
    state = state.copyWith(
      videos: [for (final video in state.videos) video.id == videoId ? update(video) : video],
    );
  }

  Future<void> toggleLike(VideoModel video) async {
    final wasLiked = video.likedByMe ?? false;
    _replaceVideo(
      video.id,
      (v) => v.copyWith(likedByMe: !wasLiked, likeCount: v.likeCount + (wasLiked ? -1 : 1)),
    );
    try {
      if (wasLiked) {
        await _repository.unlike(video.id);
      } else {
        await _repository.like(video.id);
      }
    } on AppException {
      // Revert the optimistic update on failure (e.g. already liked/unliked
      // from another session, or a network error).
      _replaceVideo(video.id, (v) => v.copyWith(likedByMe: wasLiked, likeCount: video.likeCount));
    }
  }

  Future<void> toggleFollow(VideoModel video) async {
    final author = video.author;
    if (author == null) return;
    final wasFollowing = video.isFollowedByMe ?? false;

    state = state.copyWith(
      videos: [
        for (final v in state.videos)
          v.author?.id == author.id ? v.copyWith(isFollowedByMe: !wasFollowing) : v,
      ],
    );
    try {
      if (wasFollowing) {
        await _repository.unfollow(author.id);
      } else {
        await _repository.follow(author.id);
      }
    } on AppException {
      state = state.copyWith(
        videos: [
          for (final v in state.videos)
            v.author?.id == author.id ? v.copyWith(isFollowedByMe: wasFollowing) : v,
        ],
      );
    }
  }

  void applyCommentAdded(String videoId) {
    _replaceVideo(videoId, (v) => v.copyWith(commentCount: v.commentCount + 1));
  }

  void applyCommentRemoved(String videoId) {
    _replaceVideo(videoId, (v) => v.copyWith(commentCount: v.commentCount - 1));
  }

  void applyShareCount(String videoId, int shareCount) {
    _replaceVideo(videoId, (v) => v.copyWith(shareCount: shareCount));
  }

  void removeVideo(String videoId) {
    state = state.copyWith(videos: state.videos.where((v) => v.id != videoId).toList());
  }
}

// Deliberately not `.autoDispose`: both the main feed and a creator's video
// list are cheap to keep warm for the app session (no polling, no
// subscriptions), and keeping them alive preserves scroll position and
// avoids a refetch on every tab switch. It also keeps both providers the
// same type, so widgets that work with either (VideoFeedItem, VideoPageView,
// the comment sheet) can take a single provider type as a parameter.
final feedControllerProvider = StateNotifierProvider<FeedController, FeedState>((ref) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchFeed(cursor: cursor));
});

final userVideosControllerProvider = StateNotifierProvider.family<FeedController, FeedState, String>((ref, userId) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchUserVideos(userId, cursor: cursor));
});
