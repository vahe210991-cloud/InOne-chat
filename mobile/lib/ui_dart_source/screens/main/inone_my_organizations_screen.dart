import 'package:flutter/material.dart';

import '../../../core/data/inone_organization.dart';
import '../../models/inone_models.dart';
import '../../theme/inone_theme.dart';
import '../../widgets/inone_bottom_nav.dart';
import '../../widgets/inone_ds_widgets.dart';
import '../../widgets/inone_icons.dart';

/// Native organization picker adapted from the owner-supplied Screen 190.
///
/// This screen deliberately uses the authenticated API model. Member/project
/// counts and create/search actions are omitted because GET /orgs/mine does not
/// supply those counts and no verified Beta 1.0 search/create flow is wired here.
class InOneMyOrganizationsScreen extends StatelessWidget {
  const InOneMyOrganizationsScreen({
    super.key,
    required this.organizations,
    required this.selectedOrganizationId,
    required this.locale,
    required this.onSelect,
    required this.onBack,
    required this.onTab,
  });

  final List<InOneOrganization> organizations;
  final String? selectedOrganizationId;
  final String locale;
  final ValueChanged<InOneOrganization> onSelect;
  final VoidCallback onBack;
  final ValueChanged<InOneTab> onTab;

  String _copy(String hy, String ru, String en) => switch (locale) {
        'hy' => hy,
        'ru' => ru,
        _ => en,
      };

  String _roleLabel(String role) => switch (role) {
        'owner' => _copy('Սեփականատեր', 'Владелец', 'Owner'),
        'admin' => _copy('Ադմին', 'Администратор', 'Admin'),
        _ => _copy('Անդամ', 'Участник', 'Member'),
      };

  String _statusLabel(String status) => switch (status) {
        'approved' => _copy('Հաստատված', 'Подтверждена', 'Approved'),
        'pending' => _copy('Սպասման մեջ', 'Ожидает проверки', 'Pending'),
        'rejected' => _copy('Մերժված', 'Отклонена', 'Rejected'),
        _ => status,
      };

  @override
  Widget build(BuildContext context) {
    final c = context.inone;
    return InOneShell(
      nav: InOneBottomNav(
        selected: null,
        onSelected: onTab,
        availableTabs: const {InOneTab.messages, InOneTab.profile},
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Row(
              children: [
                InOneIconAction(
                  icon: InOneIcons.back,
                  semanticLabel: _copy('Հետ', 'Назад', 'Back'),
                  onTap: onBack,
                  size: 28,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _copy('Կազմակերպություններ', 'Мои организации', 'My organizations'),
                    style: InOneText.style(18, FontWeight.w700, c.text),
                  ),
                ),
                Text(
                  '${organizations.length}',
                  style: InOneText.style(12, FontWeight.w600, c.muted),
                ),
              ],
            ),
          ),
          Expanded(
            child: organizations.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: InOneEmptyState(
                        icon: InOneIcons.building,
                        title: _copy(
                          'Կազմակերպություններ չկան',
                          'Нет доступных организаций',
                          'No organizations yet',
                        ),
                        text: _copy(
                          'Այս հաշիվը դեռ կազմակերպության անդամ չէ։',
                          'У этой учётной записи пока нет организаций.',
                          'This account is not a member of an organization yet.',
                        ),
                      ),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                    itemCount: organizations.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final organization = organizations[index];
                      final selected = organization.orgId == selectedOrganizationId;
                      final roleColor = switch (organization.role) {
                        'owner' => c.link,
                        'admin' => c.brand,
                        _ => c.muted,
                      };
                      return Material(
                        color: c.bg,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                          side: BorderSide(color: selected ? c.brand : c.border, width: selected ? 1.5 : 1),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => onSelect(organization),
                          child: Padding(
                            padding: const EdgeInsets.all(15),
                            child: Row(
                              children: [
                                InOneStripeBox(
                                  width: 48,
                                  height: 48,
                                  circle: true,
                                  borderColor: c.stripeB,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        organization.name,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: InOneText.style(14, FontWeight.w700, c.text),
                                      ),
                                      const SizedBox(height: 5),
                                      Wrap(
                                        spacing: 8,
                                        runSpacing: 4,
                                        children: [
                                          Text(
                                            _roleLabel(organization.role),
                                            style: InOneText.style(11.5, FontWeight.w700, roleColor),
                                          ),
                                          Text(
                                            '·',
                                            style: InOneText.style(11.5, FontWeight.w400, c.muted),
                                          ),
                                          Text(
                                            _statusLabel(organization.status),
                                            style: InOneText.style(11.5, FontWeight.w400, c.muted),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                if (selected)
                                  Icon(Icons.check_circle, color: c.brand, size: 22)
                                else
                                  Icon(InOneIcons.chevronRight, color: c.hint, size: 20),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
