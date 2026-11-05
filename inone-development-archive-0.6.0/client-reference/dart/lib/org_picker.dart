// Выбор организации: без зависимостей от Flutter, чтобы тестировать отдельно. НЕ ПРОВЕРЕНО.
import 'org_models.dart';

class OrgPicker {
  OrgPicker(List<UserOrg> orgs) : _orgs = List.unmodifiable(orgs) {
    _selected = _firstApproved(_orgs);
  }

  final List<UserOrg> _orgs;
  String? _selected;

  /// Все организации пользователя, в том числе ожидающие одобрения.
  List<UserOrg> get orgs => _orgs;

  /// Организации, с которыми можно работать: только одобренные.
  List<UserOrg> get selectable => _orgs.where((o) => o.status == 'approved').toList();

  String? get selectedOrgId => _selected;

  UserOrg? get selected {
    for (final o in _orgs) {
      if (o.orgId == _selected) return o;
    }
    return null;
  }

  /// Выбрать можно только одобренную организацию.
  bool select(String orgId) {
    for (final o in selectable) {
      if (o.orgId == orgId) {
        _selected = orgId;
        return true;
      }
    }
    return false;
  }

  static String? _firstApproved(List<UserOrg> orgs) {
    for (final o in orgs) {
      if (o.status == 'approved') return o.orgId;
    }
    return null;
  }
}
