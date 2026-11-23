import 'package:flutter/material.dart';

import '../../../core/data/inone_workspace_controller.dart';
import '../../../core/data/inone_workspace_repository.dart';
import '../../../core/session/inone_session.dart';
import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import 'inone_workspace_screen.dart';

/// A server-connected Workspace route. It owns its controller lifecycle, loads
/// the current membership snapshot, and exposes only organization data backed
/// by the existing API contracts.
class InOneConnectedWorkspaceScreen extends StatefulWidget {
  const InOneConnectedWorkspaceScreen({
    super.key,
    required this.session,
    required this.modules,
    required this.activity,
    required this.onNotifications,
    required this.onCustomize,
    required this.onSeeAll,
    required this.onOrganizationSelected,
    required this.onTab,
    required this.onAdd,
    this.selectedOrganizationId,
  });

  final InOneSession session;
  final List<InOneModuleTile> modules;
  final List<InOneActivityItem> activity;
  final VoidCallback? onNotifications;
  final VoidCallback? onCustomize;
  final VoidCallback? onSeeAll;
  final ValueChanged<String?> onOrganizationSelected;
  final ValueChanged<InOneTab> onTab;
  final VoidCallback onAdd;
  final String? selectedOrganizationId;

  @override
  State<InOneConnectedWorkspaceScreen> createState() =>
      _InOneConnectedWorkspaceScreenState();
}

class _InOneConnectedWorkspaceScreenState
    extends State<InOneConnectedWorkspaceScreen> {
  late InOneWorkspaceController _controller;

  @override
  void initState() {
    super.initState();
    _controller = InOneWorkspaceController(
      InOneWorkspaceRepository(widget.session),
    );
    _load();
  }

  @override
  void didUpdateWidget(covariant InOneConnectedWorkspaceScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) {
      _controller.dispose();
      _controller = InOneWorkspaceController(
        InOneWorkspaceRepository(widget.session),
      );
      _load();
    } else if (oldWidget.selectedOrganizationId != widget.selectedOrganizationId) {
      _load();
    }
  }

  void _load() {
    _controller.load(selectedOrganizationId: widget.selectedOrganizationId);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _switchWorkspace() async {
    final data = _controller.data;
    if (data == null || data.organizations.isEmpty) return;
    final selected = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Выберите организацию'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final organization in data.organizations)
              ListTile(
                title: Text(organization.name),
                subtitle: Text('${organization.role} · ${organization.status}'),
                selected: organization.orgId == data.selectedOrganization?.orgId,
                onTap: () => Navigator.of(dialogContext).pop(organization.orgId),
              ),
          ],
        ),
      ),
    );
    if (selected == null || !mounted) return;
    await _controller.selectOrganization(selected);
    if (!mounted) return;
    final current = _controller.data;
    if (_controller.error == null && current?.selectedOrganization?.orgId == selected) {
      widget.onOrganizationSelected(selected);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final data = _controller.data;
        if (_controller.isLoading && data == null) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (_controller.error != null && data == null) {
          return Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.cloud_off_outlined, size: 36),
                    const SizedBox(height: 12),
                    const Text('Не удалось загрузить рабочее пространство'),
                    const SizedBox(height: 8),
                    Text(
                      _controller.error.toString(),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _load,
                      child: const Text('Повторить'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }
        if (data == null) {
          return const Scaffold(
            body: Center(child: Text('Рабочее пространство недоступно')),
          );
        }
        return Stack(
          children: [
            InOneWorkspaceScreen(
              summary: data.workspaceSummary,
              modules: widget.modules,
              activity: widget.activity,
              onSwitchWorkspace: _switchWorkspace,
              onNotifications: widget.onNotifications,
              onCustomize: widget.onCustomize,
              onSeeAll: widget.onSeeAll,
              onTab: widget.onTab,
              onAdd: widget.onAdd,
            ),
            if (_controller.isLoading)
              const Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(minHeight: 2),
              ),
          ],
        );
      },
    );
  }
}
