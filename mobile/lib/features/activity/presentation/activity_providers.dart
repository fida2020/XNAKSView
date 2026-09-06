import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_exception.dart';
import '../../../core/network/api_client_provider.dart';
import '../data/activity_repository.dart';
import '../domain/activity_model.dart';

final activityRepositoryProvider = Provider<ActivityRepository>((ref) {
  return ActivityRepository(ref.watch(apiClientProvider));
});

enum ActivityLoadStatus { initial, loading, loadingMore, loaded, error }

class ActivityState extends Equatable {
  const ActivityState({
    this.items = const [],
    this.nextCursor,
    this.status = ActivityLoadStatus.initial,
    this.errorMessage,
  });

  final List<ActivityItem> items;
  final String? nextCursor;
  final ActivityLoadStatus status;
  final String? errorMessage;

  bool get hasMore => nextCursor != null;

  ActivityState copyWith({
    List<ActivityItem>? items,
    String? nextCursor,
    bool clearCursor = false,
    ActivityLoadStatus? status,
    String? errorMessage,
  }) {
    return ActivityState(
      items: items ?? this.items,
      nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
      status: status ?? this.status,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => [items, nextCursor, status, errorMessage];
}

class ActivityController extends StateNotifier<ActivityState> {
  ActivityController(this._repository) : super(const ActivityState()) {
    loadInitial();
  }

  final ActivityRepository _repository;

  Future<void> loadInitial() async {
    state = state.copyWith(status: ActivityLoadStatus.loading, errorMessage: null);
    try {
      final page = await _repository.fetchActivity();
      state = ActivityState(items: page.items, nextCursor: page.nextCursor, status: ActivityLoadStatus.loaded);
    } on AppException catch (error) {
      state = state.copyWith(status: ActivityLoadStatus.error, errorMessage: error.message);
    }
  }

  Future<void> loadMore() async {
    if (state.status == ActivityLoadStatus.loadingMore || !state.hasMore) return;
    state = state.copyWith(status: ActivityLoadStatus.loadingMore);
    try {
      final page = await _repository.fetchActivity(cursor: state.nextCursor);
      state = state.copyWith(
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
        clearCursor: page.nextCursor == null,
        status: ActivityLoadStatus.loaded,
      );
    } on AppException catch (error) {
      state = state.copyWith(status: ActivityLoadStatus.loaded, errorMessage: error.message);
    }
  }

  Future<void> markRead(String id) async {
    state = state.copyWith(items: [for (final item in state.items) item.id == id ? item.copyWith(read: true) : item]);
    try {
      await _repository.markRead(id);
    } on AppException {
      // Best-effort — the item just stays marked read locally either way.
    }
  }

  Future<void> markAllRead() async {
    state = state.copyWith(items: [for (final item in state.items) item.copyWith(read: true)]);
    try {
      await _repository.markAllRead();
    } on AppException {
      // Best-effort.
    }
  }
}

final activityControllerProvider = StateNotifierProvider<ActivityController, ActivityState>((ref) {
  return ActivityController(ref.watch(activityRepositoryProvider));
});
