import 'package:flutter/material.dart';

/// Единая точка подстановки иконок. Сейчас — Material Icons;
/// кастомный набор иконок подключается заменой значений здесь.
abstract final class InOneIcons {
  // Навигация
  static const IconData back = Icons.chevron_left_rounded;
  static const IconData chevronRight = Icons.chevron_right_rounded;
  static const IconData menu = Icons.menu_rounded;
  static const IconData more = Icons.more_vert_rounded;
  static const IconData plus = Icons.add_rounded;

  // Нижняя навигация: Лента, Звонки, +, Сообщения, Профиль
  static const IconData feed = Icons.dynamic_feed_outlined;
  static const IconData calls = Icons.call_outlined;
  static const IconData messages = Icons.chat_bubble_outline_rounded;
  static const IconData profile = Icons.person_outline_rounded;

  // Общие
  static const IconData search = Icons.search_rounded;
  static const IconData filter = Icons.sort_rounded;
  static const IconData edit = Icons.edit_outlined;
  static const IconData verified = Icons.verified_rounded;
  static const IconData bell = Icons.notifications_none_rounded;
  static const IconData mail = Icons.mail_outline_rounded;
  static const IconData call = Icons.call_outlined;
  static const IconData group = Icons.group_outlined;
  static const IconData camera = Icons.photo_camera_outlined;
  static const IconData attach = Icons.attach_file_rounded;
  static const IconData send = Icons.arrow_upward_rounded;
  static const IconData emoji = Icons.sentiment_satisfied_alt_outlined;
  static const IconData apple = Icons.apple;

  // Модули / элементы списков
  static const IconData tasks = Icons.check_circle_outline_rounded;
  static const IconData projects = Icons.folder_outlined;
  static const IconData files = Icons.description_outlined;
  static const IconData workspace = Icons.grid_view_rounded;
  static const IconData privacy = Icons.shield_outlined;
  static const IconData help = Icons.help_outline_rounded;
  static const IconData settings = Icons.settings_outlined;
  static const IconData logout = Icons.logout_rounded;
  static const IconData crm = Icons.favorite_border_rounded;
  static const IconData kanban = Icons.view_kanban_outlined;
  static const IconData calendar = Icons.calendar_today_outlined;
  static const IconData lead = Icons.person_add_alt_1_outlined;
  static const IconData order = Icons.receipt_long_outlined;
  static const IconData campaign = Icons.campaign_outlined;
  static const IconData deadline = Icons.event_available_outlined;
  static const IconData note = Icons.sticky_note_2_outlined;
  static const IconData quote = Icons.request_quote_outlined;
  static const IconData error = Icons.error_outline_rounded;
  static const IconData warning = Icons.warning_amber_rounded;
  static const IconData wifiOff = Icons.wifi_off_rounded;
  static const IconData chat = Icons.chat_bubble_outline_rounded;
  static const IconData searchOff = Icons.search_off_rounded;
  static const IconData inbox = Icons.inbox_outlined;
  static const IconData check = Icons.check_rounded;
  static const IconData done = Icons.done_all_rounded;
  static const IconData chevronDown = Icons.keyboard_arrow_down_rounded;
  static const IconData darkMode = Icons.dark_mode_outlined;
  static const IconData lightMode = Icons.light_mode_outlined;
  static const IconData download = Icons.file_download_outlined;
}
