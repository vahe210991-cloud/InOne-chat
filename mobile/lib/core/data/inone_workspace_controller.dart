import 'package:flutter/foundation.dart';

import 'inone_workspace_repository.dart';
import 'inone_workspace_screen_data.dart';

/// Owns the asynchronous workspace snapshot independently of app navigation.
/// The app shell can listen to this controller without duplicating API mapping.
class InOneWorkspaceController extends ChangeNotifier {
  InOneWorkspaceController(this._repository);

  final InOneWorkspaceRepository _repository;

  InOneWorkspaceScreenData? _data;
  Object? _error;
  bool _loading = false;
  int _requestGeneration = 0;
  bool _disposed = false;

  InOneWorkspaceScreenData? get data => _data;
  Object? get error => _error;
  bool get isLoading => _loading;

  Future<void> load({String? selectedOrganizationId}) async {
    if (_disposed) return;
    final generation = ++_requestGeneration;
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      final snapshot = await InOneWorkspaceScreenData.load(
        _repository,
        selectedOrganizationId: selectedOrganizationId,
      );
      if (generation != _requestGeneration) return;
      _data = snapshot;
    } catch (error) {
      if (generation != _requestGeneration) return;
      _error = error;
    } finally {
      if (generation == _requestGeneration) {
        _loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> selectOrganization(String organizationId) =>
      load(selectedOrganizationId: organizationId);

  @override
  void dispose() {
    _disposed = true;
    _requestGeneration++;
    super.dispose();
  }
}
