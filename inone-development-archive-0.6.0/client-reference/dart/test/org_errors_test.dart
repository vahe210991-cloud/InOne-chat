// Тесты справочного клиента. НЕ ЗАПУСКАЛИСЬ: нет Dart SDK в среде.
import 'package:inone_org_client/org_errors.dart';
import 'package:test/test.dart';

void main() {
  test('код сервера переводится в ключ сообщения', () {
    final e = OrgError.fromResponse(403, '{"error":"not a member","code":"org_not_member"}');
    expect(e.code, OrgErrorCode.orgNotMember);
    expect(e.messageKey, 'org.error.not_member');
  });

  test('ответ без кода не падает и даёт неизвестную ошибку', () {
    final e = OrgError.fromResponse(500, 'не JSON');
    expect(e.code, OrgErrorCode.unknown);
    expect(e.defaultMessage, isNotEmpty);
  });

  test('group is full распознаётся без кода', () {
    final e = OrgError.fromResponse(409, '{"error":"group is full"}');
    expect(e.code, OrgErrorCode.groupFull);
  });
}
