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

  Future<void> toggleRepost(VideoModel video) async {
    final wasReposted = video.repostedByMe;
    _replaceVideo(video.id, (v) => v.copyWith(repostedByMe: !wasReposted));
    try {
      if (wasReposted) {
        await _repository.undoRepost(video.id);
      } else {
        await _repository.repost(video.id);
      }
    } on AppException {
      _replaceVideo(video.id, (v) => v.copyWith(repostedByMe: wasReposted));
    }
  }

  Future<void> toggleFavorite(VideoModel video) async {
    final wasFavorited = video.favoritedByMe;
    _replaceVideo(video.id, (v) => v.copyWith(favoritedByMe: !wasFavorited));
    try {
      if (wasFavorited) {
        await _repository.unfavorite(video.id);
      } else {
        await _repository.favorite(video.id);
      }
    } on AppException {
      _replaceVideo(video.id, (v) => v.copyWith(favoritedByMe: wasFavorited));
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
  return FeedController(repository, ({cursor}) => repository.fetchFeed(cursor: cursor, scope: 'forYou'));
});

/// The Following tab (brief: TikTok-style For You / Following split) — same
/// `FeedController`/`FeedState`/`VideoPageView` as the main feed, just
/// scoped server-side to creators the caller follows.
final followingFeedControllerProvider = StateNotifierProvider<FeedController, FeedState>((ref) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchFeed(cursor: cursor, scope: 'following'));
});

/// The Friends tab (Step 2) — a real mutual follow (both directions),
/// computed server-side from the same Follow table as Following. No
/// separate friend-request system exists; this is not a fabricated
/// relationship layered on top.
final friendsFeedControllerProvider = StateNotifierProvider<FeedController, FeedState>((ref) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchFeed(cursor: cursor, scope: 'friends'));
});

final userVideosControllerProvider = StateNotifierProvider.family<FeedController, FeedState, String>((ref, userId) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchUserVideos(userId, cursor: cursor));
});

final hashtagVideosControllerProvider = StateNotifierProvider.family<FeedController, FeedState, String>((ref, tag) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchHashtagVideos(tag, cursor: cursor));
});

final searchVideosControllerProvider = StateNotifierProvider.family<FeedController, FeedState, String>((ref, query) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.searchVideos(query));
});

final addYoursResponsesControllerProvider = StateNotifierProvider.family<FeedController, FeedState, String>((ref, promptVideoId) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) => repository.fetchAddYoursResponses(promptVideoId, cursor: cursor));
});

/// Backs the shared-link deep link (`xnakview://video/:id`, Share rebuild)
/// — a real single-video fetch wrapped as a one-item, non-paginated
/// `FeedPage` so `VideoPageView`/`VideoFeedItem` (like/comment/follow/share/
/// gift, all real) can be reused unmodified for a single shared video.
final singleVideoControllerProvider = StateNotifierProvider.family<FeedController, FeedState, String>((ref, videoId) {
  final repository = ref.watch(videoRepositoryProvider);
  return FeedController(repository, ({cursor}) async {
    final video = await repository.fetchVideo(videoId);
    return FeedPage(videos: [video]);
  });
});
