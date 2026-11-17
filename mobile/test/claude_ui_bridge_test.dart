import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/claude_ui_bridge.dart';

void main() {
  test('parses navigation events from the Claude v2 bridge', () {
    final message = ClaudeBridgeMessage.tryParse(
      '{"type":"navigate","screen":"SC-01","data":{"screen":"SC-02"}}',
    );

    expect(message?.type, ClaudeBridgeEventType.navigate);
    expect(message?.screenId, 'SC-01');
    expect(message?.targetScreen, 'SC-02');
  });

  test('parses API events without logging or persisting form secrets', () {
    final message = ClaudeBridgeMessage.tryParse(
      '{"type":"api","screen":"SC-01","data":{"call":"POST /login","body":{"email":"a@b.test","password":"secret"}}}',
    );

    expect(message?.type, ClaudeBridgeEventType.api);
    expect(message?.call, 'POST /login');
    expect(message?.body['password'], 'secret');
  });

  test('parses document picker events', () {
    final message = ClaudeBridgeMessage.tryParse(
      '{"type":"pick","screen":"RQ-02","data":{"what":"document"}}',
    );

    expect(message?.type, ClaudeBridgeEventType.pick);
    expect(message?.pickWhat, 'document');
  });

  test('rejects malformed and unknown bridge messages', () {
    expect(ClaudeBridgeMessage.tryParse('not-json'), isNull);
    expect(ClaudeBridgeMessage.tryParse('{"type":"eval","screen":"SC-01","data":{}}'), isNull);
    expect(ClaudeBridgeMessage.tryParse('{"type":"navigate","screen":"SC-01","data":{}}'), isNull);
  });

  test('accepts approved v1 bridge events that omit the screen field', () {
    final message = ClaudeBridgeMessage.tryParse(
      '{"type":"navigate","data":{"screen":"CH-01"}}',
    );

    expect(message?.type, ClaudeBridgeEventType.navigate);
    expect(message?.screenId, 'legacy-v1');
    expect(message?.targetScreen, 'CH-01');
  });

  test('screen API allowlist prevents cross-screen and unknown calls', () {
    expect(claudeScreenAllowsApiCall('SC-01', 'POST /login'), isTrue);
    expect(claudeScreenAllowsApiCall('SC-01', 'POST /logout'), isFalse);
    expect(claudeScreenAllowsApiCall('SC-05', 'POST /auth/nonce'), isFalse);
    expect(claudeScreenAllowsApiCall('legacy-v1', 'GET /rooms/mine'), isFalse);
    expect(claudeScreenAllowsApiCall('CH-02', 'POST /mls/groups/id/messages'), isFalse);
  });

  test('API allowlist contains only backend routes currently supported', () {
    expect(claudeSupportedApiCalls['GET /rooms/mine']?.path, '/rooms/mine');
    expect(claudeSupportedApiCalls['GET /org-requests']?.path, '/org-requests');
    expect(claudeSupportedApiCalls.containsKey('POST /auth/provider/verify'), isFalse);
    expect(claudeSupportedApiCalls.containsKey('PUT /devices/me/push'), isFalse);
    expect(claudeSupportedApiCalls.containsKey('GET /org-requests/:id'), isFalse);
    expect(claudeSupportedApiCalls.containsKey('GET /rooms/:id/events'), isFalse);
  });
}
