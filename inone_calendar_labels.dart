/// Подписи календаря. Армянский — основной язык; русский и английский —
/// дополнительные (язык переключается в настройках приложения).
class InOneCalendarLabels {
  const InOneCalendarLabels({
    required this.title,
    required this.today,
    required this.viewMonth,
    required this.viewWeek,
    required this.viewDay,
    required this.addEvent,
    required this.search,
    required this.back,
    required this.edit,
    required this.more,
    required this.close,
    required this.weekdaysShort,
    required this.weekdaysFull,
    required this.monthsNominative,
    required this.monthsGenitive,
    required this.monthsShort,
    required this.eventsCount,
    required this.kindMeeting,
    required this.kindCall,
    required this.kindVisit,
    required this.kindDeadline,
    required this.videoJoin,
    required this.videoLinkHint,
    required this.reminderHint,
    required this.repeatHint,
    required this.organizerLine,
    required this.participantsHeading,
    required this.description,
    required this.organizerRole,
    required this.participantRole,
    required this.statusGoing,
    required this.statusPending,
    required this.statusDeclined,
    required this.rsvpNo,
    required this.rsvpYes,
    required this.newEventTitle,
    required this.fieldTitle,
    required this.fieldStart,
    required this.fieldEnd,
    required this.allDay,
    required this.fieldParticipants,
    required this.participantsCount,
    required this.fieldLocation,
    required this.addLocation,
    required this.fieldReminder,
    required this.reminderOptions,
    required this.fieldRepeat,
    required this.save,
    required this.availabilityTitle,
    required this.free,
    required this.busy,
    required this.suggestedTimes,
    required this.allFree,
    required this.pickTime,
  });

  final String title;
  final String today;
  final String viewMonth;
  final String viewWeek;
  final String viewDay;
  final String addEvent;
  final String search;
  final String back;
  final String edit;
  final String more;
  final String close;

  /// Понедельник — первый.
  final List<String> weekdaysShort;
  final List<String> weekdaysFull;
  final List<String> monthsNominative;
  final List<String> monthsGenitive;
  final List<String> monthsShort;
  final String Function(int count) eventsCount;

  final String kindMeeting;
  final String kindCall;
  final String kindVisit;
  final String kindDeadline;

  final String videoJoin;
  final String videoLinkHint;
  final String reminderHint;
  final String repeatHint;
  final String Function(String name) organizerLine;
  final String Function(int count) participantsHeading;
  final String description;
  final String organizerRole;
  final String participantRole;
  final String statusGoing;
  final String statusPending;
  final String statusDeclined;
  final String rsvpNo;
  final String rsvpYes;

  final String newEventTitle;
  final String fieldTitle;
  final String fieldStart;
  final String fieldEnd;
  final String allDay;
  final String fieldParticipants;
  final String Function(int count) participantsCount;
  final String fieldLocation;
  final String addLocation;
  final String fieldReminder;

  /// В порядке [InOneReminder]: none, min5, min15, hour1, day1.
  final List<String> reminderOptions;
  final String fieldRepeat;
  final String save;

  final String availabilityTitle;
  final String free;
  final String busy;
  final String suggestedTimes;
  final String allFree;
  final String pickTime;

  String monthYear(DateTime d) => '${monthsNominative[d.month - 1]} ${d.year}';
  String dayMonth(DateTime d) => '${d.day} ${monthsGenitive[d.month - 1]}';
  String dayMonthWeekday(DateTime d) => '${dayMonth(d)} · ${weekdaysFull[d.weekday - 1]}';
  String dayMonthShort(DateTime d) => '${d.day} ${monthsShort[d.month - 1]}';

  /// «9 – 15 նոյեմբերի» (или с двумя месяцами, если неделя на границе).
  String weekRange(DateTime monday) {
    final sunday = monday.add(const Duration(days: 6));
    if (monday.month == sunday.month) {
      return '${monday.day} – ${sunday.day} ${monthsGenitive[sunday.month - 1]}';
    }
    return '${dayMonth(monday)} – ${dayMonth(sunday)}';
  }

  static const InOneCalendarLabels hy = InOneCalendarLabels(
    title: 'Օրացույց',
    today: 'Այսօր',
    viewMonth: 'Ամիս',
    viewWeek: 'Շաբաթ',
    viewDay: 'Օր',
    addEvent: 'Նոր իրադարձություն',
    search: 'Որոնում',
    back: 'Հետ',
    edit: 'Խմբագրել',
    more: 'Ավելին',
    close: 'Փակել',
    weekdaysShort: ['Երկ', 'Երք', 'Չրք', 'Հնգ', 'Ուրբ', 'Շբթ', 'Կիր'],
    weekdaysFull: [
      'Երկուշաբթի',
      'Երեքշաբթի',
      'Չորեքշաբթի',
      'Հինգշաբթի',
      'Ուրբաթ',
      'Շաբաթ',
      'Կիրակի',
    ],
    monthsNominative: [
      'Հունվար',
      'Փետրվար',
      'Մարտ',
      'Ապրիլ',
      'Մայիս',
      'Հունիս',
      'Հուլիս',
      'Օգոստոս',
      'Սեպտեմբեր',
      'Հոկտեմբեր',
      'Նոյեմբեր',
      'Դեկտեմբեր',
    ],
    monthsGenitive: [
      'հունվարի',
      'փետրվարի',
      'մարտի',
      'ապրիլի',
      'մայիսի',
      'հունիսի',
      'հուլիսի',
      'օգոստոսի',
      'սեպտեմբերի',
      'հոկտեմբերի',
      'նոյեմբերի',
      'դեկտեմբերի',
    ],
    monthsShort: ['հնվ', 'փտվ', 'մրտ', 'ապր', 'մյս', 'հնս', 'հլս', 'օգս', 'սպտ', 'հկտ', 'նոյ', 'դկտ'],
    eventsCount: _hyEvents,
    kindMeeting: 'Հանդիպում',
    kindCall: 'Զանգ',
    kindVisit: 'Այց',
    kindDeadline: 'Ժամկետ',
    videoJoin: 'Միանալ տեսազանգին',
    videoLinkHint: 'Տեսազանգի հղում',
    reminderHint: 'Հիշեցում',
    repeatHint: 'Կրկնություն',
    organizerLine: _hyOrganizer,
    participantsHeading: _hyParticipants,
    description: 'Նկարագրություն',
    organizerRole: 'Կազմակերպիչ',
    participantRole: 'Մասնակից',
    statusGoing: 'Գալիս է',
    statusPending: 'Սպասում է',
    statusDeclined: 'Չի գալիս',
    rsvpNo: 'Չեմ մասնակցի',
    rsvpYes: 'Մասնակցում եմ',
    newEventTitle: 'Նոր իրադարձություն',
    fieldTitle: 'Վերնագիր',
    fieldStart: 'Սկիզբ',
    fieldEnd: 'Ավարտ',
    allDay: 'Ամբողջ օրը',
    fieldParticipants: 'Մասնակիցներ',
    participantsCount: _hyParticipantsCount,
    fieldLocation: 'Վայր',
    addLocation: 'Ավելացնել վայր',
    fieldReminder: 'Հիշեցում',
    reminderOptions: ['Առանց հիշեցման', '5 րոպե', '15 րոպե', '1 ժամ', '1 օր'],
    fieldRepeat: 'Կրկնություն',
    save: 'Պահպանել',
    availabilityTitle: 'Հասանելիություն',
    free: 'Ազատ',
    busy: 'Զբաղված',
    suggestedTimes: 'Առաջարկվող ժամեր',
    allFree: 'Բոլոր մասնակիցներն ազատ են ընտրված ժամին։',
    pickTime: 'Ընտրել ժամը',
  );

  static const InOneCalendarLabels ru = InOneCalendarLabels(
    title: 'Календарь',
    today: 'Сегодня',
    viewMonth: 'Месяц',
    viewWeek: 'Неделя',
    viewDay: 'День',
    addEvent: 'Новое событие',
    search: 'Поиск',
    back: 'Назад',
    edit: 'Изменить',
    more: 'Ещё',
    close: 'Закрыть',
    weekdaysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    weekdaysFull: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
    monthsNominative: [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ],
    monthsGenitive: [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ],
    monthsShort: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    eventsCount: _ruEvents,
    kindMeeting: 'Встреча',
    kindCall: 'Звонок',
    kindVisit: 'Выезд',
    kindDeadline: 'Срок',
    videoJoin: 'Присоединиться к видеозвонку',
    videoLinkHint: 'Ссылка на видеозвонок',
    reminderHint: 'Напоминание',
    repeatHint: 'Повторение',
    organizerLine: _ruOrganizer,
    participantsHeading: _ruParticipants,
    description: 'Описание',
    organizerRole: 'Организатор',
    participantRole: 'Участник',
    statusGoing: 'Придёт',
    statusPending: 'Ожидает',
    statusDeclined: 'Не придёт',
    rsvpNo: 'Не приду',
    rsvpYes: 'Приду',
    newEventTitle: 'Новое событие',
    fieldTitle: 'Название',
    fieldStart: 'Начало',
    fieldEnd: 'Конец',
    allDay: 'Весь день',
    fieldParticipants: 'Участники',
    participantsCount: _ruParticipantsCount,
    fieldLocation: 'Место',
    addLocation: 'Добавить место',
    fieldReminder: 'Напоминание',
    reminderOptions: ['Без напоминания', '5 минут', '15 минут', '1 час', '1 день'],
    fieldRepeat: 'Повторение',
    save: 'Сохранить',
    availabilityTitle: 'Доступность',
    free: 'Свободен',
    busy: 'Занят',
    suggestedTimes: 'Предлагаемое время',
    allFree: 'В выбранное время все участники свободны.',
    pickTime: 'Выбрать время',
  );

  static const InOneCalendarLabels en = InOneCalendarLabels(
    title: 'Calendar',
    today: 'Today',
    viewMonth: 'Month',
    viewWeek: 'Week',
    viewDay: 'Day',
    addEvent: 'New event',
    search: 'Search',
    back: 'Back',
    edit: 'Edit',
    more: 'More',
    close: 'Close',
    weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weekdaysFull: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    monthsNominative: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsGenitive: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    eventsCount: _enEvents,
    kindMeeting: 'Meeting',
    kindCall: 'Call',
    kindVisit: 'Visit',
    kindDeadline: 'Deadline',
    videoJoin: 'Join video call',
    videoLinkHint: 'Video call link',
    reminderHint: 'Reminder',
    repeatHint: 'Repeat',
    organizerLine: _enOrganizer,
    participantsHeading: _enParticipants,
    description: 'Description',
    organizerRole: 'Organizer',
    participantRole: 'Participant',
    statusGoing: 'Going',
    statusPending: 'Pending',
    statusDeclined: 'Declined',
    rsvpNo: "Can't go",
    rsvpYes: "I'm going",
    newEventTitle: 'New event',
    fieldTitle: 'Title',
    fieldStart: 'Start',
    fieldEnd: 'End',
    allDay: 'All day',
    fieldParticipants: 'Participants',
    participantsCount: _enParticipantsCount,
    fieldLocation: 'Location',
    addLocation: 'Add location',
    fieldReminder: 'Reminder',
    reminderOptions: ['No reminder', '5 min', '15 min', '1 hour', '1 day'],
    fieldRepeat: 'Repeat',
    save: 'Save',
    availabilityTitle: 'Availability',
    free: 'Free',
    busy: 'Busy',
    suggestedTimes: 'Suggested times',
    allFree: 'All participants are free at the selected time.',
    pickTime: 'Pick time',
  );
}

String _hyEvents(int n) => '$n իրադարձություն';
String _hyOrganizer(String name) => 'Կազմակերպիչ՝ $name';
String _hyParticipants(int n) => 'Մասնակիցներ · $n';
String _hyParticipantsCount(int n) => '$n մասնակից';

String _ruEvents(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n событие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return '$n события';
  return '$n событий';
}

String _ruOrganizer(String name) => 'Организатор: $name';
String _ruParticipants(int n) => 'Участники · $n';
String _ruParticipantsCount(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n участник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return '$n участника';
  return '$n участников';
}

String _enEvents(int n) => n == 1 ? '1 event' : '$n events';
String _enOrganizer(String name) => 'Organizer: $name';
String _enParticipants(int n) => 'Participants · $n';
String _enParticipantsCount(int n) => n == 1 ? '1 participant' : '$n participants';
