import '../models/inone_calendar_models.dart';

/// Событие, размещённое на временной сетке: [lane] из [lanes] колонок
/// (пересекающиеся события делят ширину поровну).
class InOneLaidOut {
  const InOneLaidOut(this.event, this.lane, this.lanes);
  final InOneCalendarEvent event;
  final int lane;
  final int lanes;
}

/// Раскладывает пересекающиеся события по колонкам.
/// События без [InOneCalendarEvent.end] считаются часовыми.
List<InOneLaidOut> inOneLaneLayout(List<InOneCalendarEvent> events) {
  final sorted = [...events]..sort((a, b) => a.start.compareTo(b.start));
  final result = <InOneLaidOut>[];
  var cluster = <(InOneCalendarEvent, int)>[];
  var laneEnds = <DateTime>[];
  DateTime? clusterEnd;

  void flush() {
    final lanes = laneEnds.length;
    for (final (event, lane) in cluster) {
      result.add(InOneLaidOut(event, lane, lanes));
    }
    cluster = <(InOneCalendarEvent, int)>[];
    laneEnds = <DateTime>[];
    clusterEnd = null;
  }

  for (final e in sorted) {
    final end = e.end ?? e.start.add(const Duration(hours: 1));
    final currentEnd = clusterEnd;
    if (currentEnd != null && !e.start.isBefore(currentEnd)) flush();
    var lane = laneEnds.indexWhere((x) => !x.isAfter(e.start));
    if (lane == -1) {
      laneEnds.add(end);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = end;
    }
    cluster.add((e, lane));
    final latest = clusterEnd;
    if (latest == null || end.isAfter(latest)) clusterEnd = end;
  }
  flush();
  return result;
}

/// Дробный час начала/конца события относительно полуночи его дня.
double inOneHourOf(DateTime d) => d.hour + d.minute / 60.0;
