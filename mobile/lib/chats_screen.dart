import 'package:flutter/material.dart';

import 'core/data/inone_repositories.dart';
import 'core/data/inone_room.dart';
import 'core/network/api_exception.dart';
import 'core/session/inone_session.dart';

const _lime = Color(0xFFC8F23D);
const _green = Color(0xFF5C803B);
const _ink = Color(0xFF242820);
const _muted = Color(0xFF858B80);
const _surfaceSoft = Color(0xFFF1F3EB);

/// Native Flutter implementation of CH-01. Room data is always loaded from
/// the authenticated GET /rooms/mine repository; no demo conversations are
/// injected into the production list.
class InOneChatsScreen extends StatefulWidget {
  const InOneChatsScreen({
    required this.repositories,
    required this.session,
    super.key,
  });

  final InOneRepositories repositories;
  final InOneSession session;

  @override
  State<InOneChatsScreen> createState() => _InOneChatsScreenState();
}

class _InOneChatsScreenState extends State<InOneChatsScreen> {
  List<InOneRoom> _rooms = const [];
  final Set<String> _pinned = {};
  final Set<String> _archived = {};
  String _folder = 'all';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_sessionChanged);
    _loadRooms();
  }

  @override
  void dispose() {
    widget.session.removeListener(_sessionChanged);
    super.dispose();
  }

  void _sessionChanged() {
    if (!mounted) return;
    if (!widget.session.isAuthenticated) {
      setState(() {
        _rooms = const [];
        _loading = false;
        _error = 'Войдите в InOne, чтобы увидеть свои чаты.';
      });
    } else {
      _loadRooms();
    }
  }

  Future<void> _loadRooms() async {
    if (!widget.session.isAuthenticated) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Войдите в InOne, чтобы увидеть свои чаты.';
        _rooms = const [];
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rooms = await widget.repositories.myRooms();
      if (!mounted) return;
      setState(() {
        _rooms = rooms;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.statusCode == 401
            ? 'Сессия завершена. Войдите снова.'
            : 'Не удалось загрузить чаты. Попробуйте ещё раз.';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Не удалось загрузить чаты. Проверьте соединение.';
      });
    }
  }

  List<InOneRoom> get _visibleRooms {
    final rooms = _rooms.where((room) {
      if (_archived.contains(room.roomId)) return false;
      switch (_folder) {
        case 'groups':
          return room.kind == 'group';
        case 'channels':
          return room.kind == 'channel';
        case 'personal':
          return room.kind == 'direct';
        case 'work':
          return room.kind != 'direct';
        default:
          return true;
      }
    }).toList();
    rooms.sort((a, b) {
      final pinOrder = (_pinned.contains(b.roomId) ? 1 : 0) -
          (_pinned.contains(a.roomId) ? 1 : 0);
      return pinOrder != 0
          ? pinOrder
          : a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase());
    });
    return rooms;
  }

  void _openSearch() {
    Navigator.of(context).push(PageRouteBuilder<void>(
      transitionDuration: const Duration(milliseconds: 240),
      reverseTransitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (_, __, ___) => _InOneChatSearchPage(rooms: _rooms),
      transitionsBuilder: (_, animation, __, child) => FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, .035),
            end: Offset.zero,
          ).animate(CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
          )),
          child: child,
        ),
      ),
    ));
  }

  Future<void> _openRoomActions(InOneRoom room, Rect anchor) async {
    final screen = MediaQuery.sizeOf(context);
    final menuHeight = screen.height * .54 < 420 ? screen.height * .54 : 420.0;
    final menuWidth = (screen.width - 28).clamp(260.0, 340.0).toDouble();
    final third = screen.height / 3;
    double top;
    if (anchor.top < third) {
      top = (anchor.bottom + 8).clamp(12.0, screen.height - menuHeight - 12).toDouble();
    } else if (anchor.bottom > screen.height - third) {
      top = (anchor.top - menuHeight - 8).clamp(12.0, screen.height - menuHeight - 12).toDouble();
    } else {
      top = (anchor.center.dy - menuHeight / 2).clamp(12.0, screen.height - menuHeight - 12).toDouble();
    }
    final left = (anchor.right - menuWidth).clamp(12.0, screen.width - menuWidth - 12).toDouble();
    final action = await showGeneralDialog<String>(
      context: context,
      barrierLabel: 'Действия с чатом',
      barrierDismissible: true,
      barrierColor: Colors.black.withOpacity(.08),
      transitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (_, __, ___) => Stack(children: [
        Positioned(
          left: left,
          top: top,
          width: menuWidth,
          child: Material(
            color: Colors.white,
            elevation: 14,
            shadowColor: Colors.black.withOpacity(.12),
            borderRadius: BorderRadius.circular(22),
            clipBehavior: Clip.antiAlias,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: screen.height * .54),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 38,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFDCE3D3),
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                    ),
                    Text(room.displayName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    const Text('Управление перепиской',
                        style: TextStyle(color: _muted)),
                    const SizedBox(height: 14),
                    _MenuAction(
                      icon: Icons.push_pin_rounded,
                      label: _pinned.contains(room.roomId) ? 'Открепить' : 'Закрепить',
                      onTap: () => Navigator.pop(
                        context,
                        _pinned.contains(room.roomId) ? 'unpin' : 'pin',
                      ),
                    ),
                    _MenuAction(
                      icon: Icons.mark_chat_unread_outlined,
                      label: 'Пометить как непрочитанное',
                      onTap: () => Navigator.pop(context, 'unread'),
                    ),
                    _MenuAction(
                      icon: Icons.folder_outlined,
                      label: 'Переместить в архив',
                      onTap: () => Navigator.pop(context, 'archive'),
                    ),
                    _MenuAction(
                      icon: Icons.close_rounded,
                      label: 'Закрыть',
                      onTap: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ]),
      transitionBuilder: (_, animation, __, child) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(
          scale: Tween<double>(begin: .97, end: 1).animate(
            CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
          ),
          child: child,
        ),
      ),
    );
    if (!mounted || action == null) return;
    setState(() {
      switch (action) {
        case 'pin':
          _pinned.add(room.roomId);
          break;
        case 'unpin':
          _pinned.remove(room.roomId);
          break;
        case 'archive':
          _archived.add(room.roomId);
          break;
        case 'unread':
          break;
      }
    });
    if (action == 'pin' || action == 'unpin') {
      _notice('Закрепление пока действует только в этом сеансе.');
    }
    if (action == 'unread') {
      _notice('Отметка непрочитанного пока не поддерживается backend.');
    }
    if (action == 'archive') {
      _notice('Архивирование пока действует только в этом сеансе.');
    }
  }

  void _notice(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final rooms = _visibleRooms;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 14, 22, 14),
              child: Row(
                children: [
                  const Text('Чаты',
                      style: TextStyle(fontSize: 27, fontWeight: FontWeight.w850, color: _ink)),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Обновить чаты',
                    onPressed: _loading ? null : _loadRooms,
                    icon: const Icon(Icons.tune_rounded, color: _muted),
                  ),
                  IconButton(
                    tooltip: 'Ещё',
                    onPressed: () => _notice('Дополнительные настройки появятся позже.'),
                    icon: const Icon(Icons.more_horiz, color: _muted),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: Color(0xFFE8EAE4)),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(18),
                      onTap: _openSearch,
                      child: Container(
                        height: 56,
                        padding: const EdgeInsets.symmetric(horizontal: 17),
                        decoration: BoxDecoration(
                          color: _surfaceSoft,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: const Row(children: [
                          Icon(Icons.search, color: _muted, size: 23),
                          SizedBox(width: 12),
                          Text('Поиск по чатам',
                              style: TextStyle(fontSize: 16, color: _muted)),
                        ]),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Material(
                    color: _lime,
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(18),
                      onTap: () => _notice('Создание чата будет подключено отдельным API.'),
                      child: const SizedBox(
                        width: 56,
                        height: 56,
                        child: Icon(Icons.add, size: 31, color: _ink),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 18),
                children: [
                  _FolderChip(label: 'Все', value: 'all', selected: _folder == 'all',
                      onTap: () => setState(() => _folder = 'all')),
                  _FolderChip(label: 'Рабочие', value: 'work', selected: _folder == 'work',
                      onTap: () => setState(() => _folder = 'work')),
                  _FolderChip(label: 'Личные', value: 'personal', selected: _folder == 'personal',
                      onTap: () => setState(() => _folder = 'personal')),
                  _FolderChip(label: 'Группы', value: 'groups', selected: _folder == 'groups',
                      onTap: () => setState(() => _folder = 'groups')),
                  _FolderChip(label: 'Каналы', value: 'channels', selected: _folder == 'channels',
                      onTap: () => setState(() => _folder = 'channels')),
                ],
              ),
            ),
            const SizedBox(height: 22),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 22),
              child: Row(children: [
                const Text('Последние сообщения',
                    style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: _ink)),
                const Spacer(),
                const Text('Ваши переписки',
                    style: TextStyle(color: _green, fontWeight: FontWeight.w700)),
              ]),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: _green))
                  : _error != null
                      ? _StatusPanel(message: _error!, onRetry: _loadRooms)
                      : rooms.isEmpty
                          ? const _StatusPanel(
                              message: 'Пока нет чатов. Создайте новую переписку или дождитесь приглашения.',
                            )
                          : RefreshIndicator(
                              color: _green,
                              onRefresh: _loadRooms,
                              child: ListView.separated(
                                padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
                                itemCount: rooms.length,
                                separatorBuilder: (_, __) => const Divider(
                                  height: 1,
                                  indent: 78,
                                  color: Color(0xFFE8EAE4),
                                ),
                                itemBuilder: (context, index) {
                                  final room = rooms[index];
                                  return _RoomTile(
                                    room: room,
                                    pinned: _pinned.contains(room.roomId),
                                    onLongPress: (rect) => _openRoomActions(room, rect),
                                    onOpen: () => _notice(
                                      'История сообщений подключается отдельно через MLS.',
                                    ),
                                  );
                                },
                              ),
                            ),
            ),
            _BottomNavigation(onTap: (label) {
              if (label != 'Сообщения') _notice('$label: раздел будет подключён следующим этапом.');
            }),
          ],
        ),
      ),
    );
  }
}

class _RoomTile extends StatelessWidget {
  const _RoomTile({
    required this.room,
    required this.pinned,
    required this.onLongPress,
    required this.onOpen,
  });

  final InOneRoom room;
  final bool pinned;
  final ValueChanged<Rect> onLongPress;
  final VoidCallback onOpen;

  IconData get _icon => switch (room.kind) {
        'direct' => Icons.person_outline_rounded,
        'channel' => Icons.campaign_outlined,
        _ => Icons.groups_2_outlined,
      };

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onOpen,
      onLongPressStart: (_) {
        final box = context.findRenderObject() as RenderBox?;
        if (box == null) return;
        final origin = box.localToGlobal(Offset.zero);
        onLongPress(origin & box.size);
      },
      child: SizedBox(
        height: 94,
        child: Row(
          children: [
            Container(
              width: 60,
              height: 60,
              decoration: BoxDecoration(
                color: _surfaceSoft,
                borderRadius: BorderRadius.circular(19),
                border: pinned ? Border.all(color: _lime, width: 3) : null,
              ),
              child: Icon(_icon, size: 29, color: _green),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(room.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: _ink)),
                  const SizedBox(height: 5),
                  Text(_kindLabel(room.kind) + ' · ' + _roleLabel(room.role),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: _muted)),
                ],
              ),
            ),
            if (pinned) const Icon(Icons.push_pin_rounded, color: _green, size: 19),
          ],
        ),
      ),
    );
  }
}

String _kindLabel(String kind) => switch (kind) {
      'direct' => 'Личная переписка',
      'channel' => 'Канал',
      _ => 'Группа',
    };

String _roleLabel(String role) => switch (role) {
      'owner' => 'Владелец',
      'admin' => 'Администратор',
      _ => 'Участник',
    };

class _FolderChip extends StatelessWidget {
  const _FolderChip({required this.label, required this.value, required this.selected, required this.onTap});
  final String label;
  final String value;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 10),
        child: ChoiceChip(
          label: Text(label),
          selected: selected,
          onSelected: (_) => onTap(),
          showCheckmark: false,
          selectedColor: _lime,
          backgroundColor: Colors.white,
          side: BorderSide(color: selected ? _lime : const Color(0xFFE3E6DF)),
          labelStyle: TextStyle(
            color: _ink,
            fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          shape: const StadiumBorder(),
        ),
      );
}

class _MenuAction extends StatelessWidget {
  const _MenuAction({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Material(
          color: _surfaceSoft,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
              child: Row(children: [
                Icon(icon, color: _green),
                const SizedBox(width: 12),
                Expanded(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
              ]),
            ),
          ),
        ),
      );
}

class _StatusPanel extends StatelessWidget {
  const _StatusPanel({required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(message, textAlign: TextAlign.center,
                style: const TextStyle(color: _muted, height: 1.4)),
            if (onRetry != null) ...[
              const SizedBox(height: 14),
              TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Повторить'),
              ),
            ],
          ]),
        ),
      );
}

class _BottomNavigation extends StatelessWidget {
  const _BottomNavigation({required this.onTap});
  final ValueChanged<String> onTap;

  static const _items = [
    ('Статусы', Icons.circle_outlined),
    ('Звонки', Icons.call_outlined),
    ('Каналы', Icons.campaign_outlined),
    ('Сообщения', Icons.chat_bubble_outline_rounded),
    ('Профиль', Icons.person_outline_rounded),
  ];

  @override
  Widget build(BuildContext context) => Container(
        height: 68 + MediaQuery.paddingOf(context).bottom,
        padding: EdgeInsets.fromLTRB(8, 7, 8, 7 + MediaQuery.paddingOf(context).bottom),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFE8EAE4))),
        ),
        child: Row(
          children: _items.map((item) {
            final active = item.$1 == 'Сообщения';
            return Expanded(
              child: InkWell(
                onTap: () => onTap(item.$1),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(item.$2, color: active ? _green : _muted, size: 22),
                  const SizedBox(height: 4),
                  Text(item.$1, maxLines: 1,
                      style: TextStyle(
                        fontSize: 10,
                        color: active ? _green : _muted,
                        fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                      )),
                ]),
              ),
            );
          }).toList(),
        ),
      );
}

class _InOneChatSearchPage extends StatefulWidget {
  const _InOneChatSearchPage({required this.rooms});
  final List<InOneRoom> rooms;

  @override
  State<_InOneChatSearchPage> createState() => _InOneChatSearchPageState();
}

class _InOneChatSearchPageState extends State<_InOneChatSearchPage> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final matches = widget.rooms
        .where((room) => query.isNotEmpty && room.displayName.toLowerCase().contains(query))
        .toList();
    final direct = matches.where((room) => room.kind == 'direct').toList();
    final groups = matches.where((room) => room.kind == 'group').toList();
    final channels = matches.where((room) => room.kind == 'channel').toList();
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  autofocus: true,
                  onChanged: (value) => setState(() => _query = value),
                  decoration: InputDecoration(
                    hintText: 'Поиск контактов, групп, каналов и сообщений',
                    prefixIcon: const Icon(Icons.search),
                    filled: true,
                    fillColor: _surfaceSoft,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Отмена'),
              ),
            ]),
          ),
          Expanded(
            child: query.isEmpty
                ? const Center(
                    child: Text('Начните вводить имя или название',
                        style: TextStyle(color: _muted)),
                  )
                : ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    children: [
                      _SearchSection(title: 'Контакты', rooms: direct),
                      _SearchSection(title: 'Группы', rooms: groups),
                      _SearchSection(title: 'Каналы', rooms: channels),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 18),
                        child: Text(
                          'Поиск по тексту сообщений и файлам появится после подключения API истории сообщений.',
                          style: TextStyle(color: _muted, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
          ),
        ]),
      ),
    );
  }
}

class _SearchSection extends StatefulWidget {
  const _SearchSection({required this.title, required this.rooms});
  final String title;
  final List<InOneRoom> rooms;

  @override
  State<_SearchSection> createState() => _SearchSectionState();
}

class _SearchSectionState extends State<_SearchSection> {
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final rooms = widget.rooms;
    if (rooms.isEmpty) return const SizedBox.shrink();
    final visible = _showAll ? rooms : rooms.take(3).toList();
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const Spacer(),
          if (rooms.length > 3)
            TextButton(
              onPressed: () => setState(() => _showAll = !_showAll),
              child: Text(_showAll ? 'Свернуть' : 'Показать все'),
            ),
        ]),
        ...visible.map((room) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(
                backgroundColor: _surfaceSoft,
                child: Icon(Icons.forum_outlined, color: _green),
              ),
              title: Text(room.displayName),
              subtitle: Text(_kindLabel(room.kind)),
            )),
      ]),
    );
  }
}
