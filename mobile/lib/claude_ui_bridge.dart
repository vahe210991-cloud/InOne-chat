import 'dart:convert';

enum ClaudeBridgeEventType { navigate, api, pick }

class ClaudeBridgeMessage {
  const ClaudeBridgeMessage({
    required this.type,
    required this.screenId,
    this.targetScreen,
    this.call,
    this.body = const {},
    this.pickWhat,
  });

  final ClaudeBridgeEventType type;
  final String screenId;
  final String? targetScreen;
  final String? call;
  final Map<String, dynamic> body;
  final String? pickWhat;

  static ClaudeBridgeMessage? tryParse(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final typeName = decoded['type'];
      final screenId = decoded['screen'];
      final data = decoded['data'];
      if (typeName is! String || screenId is! String || data is! Map) {
        return null;
      }

      final type = switch (typeName) {
        'navigate' => ClaudeBridgeEventType.navigate,
        'api' => ClaudeBridgeEventType.api,
        'pick' => ClaudeBridgeEventType.pick,
        _ => null,
      };
      if (type == null) return null;

      switch (type) {
        case ClaudeBridgeEventType.navigate:
          final target = data['screen'];
          if (target is! String || target.trim().isEmpty) return null;
          return ClaudeBridgeMessage(
            type: type,
            screenId: screenId,
            targetScreen: target,
          );
        case ClaudeBridgeEventType.api:
          final call = data['call'];
          final body = data['body'];
          if (call is! String || call.trim().isEmpty || (body != null && body is! Map)) {
            return null;
          }
          return ClaudeBridgeMessage(
            type: type,
            screenId: screenId,
            call: call,
            body: body is Map ? Map<String, dynamic>.from(body) : const {},
          );
        case ClaudeBridgeEventType.pick:
          final what = data['what'];
          if (what is! String || what.trim().isEmpty) return null;
          return ClaudeBridgeMessage(
            type: type,
            screenId: screenId,
            pickWhat: what,
          );
      }
    } catch (_) {
      return null;
    }
  }
}

/// Only endpoints already present in the current backend are callable from
/// the handoff screens. The UI's declared API strings are not trusted routes.
class ClaudeApiRoute {
  const ClaudeApiRoute(this.method, this.path, {this.authenticated = true});
  final String method;
  final String path;
  final bool authenticated;
}

const claudeSupportedApiCalls = <String, ClaudeApiRoute>{
  'POST /login': ClaudeApiRoute('POST', '/login', authenticated: false),
  'POST /register/email': ClaudeApiRoute('POST', '/register/email', authenticated: false),
  'POST /register/email/confirm': ClaudeApiRoute('POST', '/register/email/confirm', authenticated: false),
  'POST /register': ClaudeApiRoute('POST', '/register', authenticated: false),
  'POST /logout': ClaudeApiRoute('POST', '/logout'),
  'GET /orgs/mine': ClaudeApiRoute('GET', '/orgs/mine'),
  'GET /org-requests': ClaudeApiRoute('GET', '/org-requests'),
  'GET /org-requests/:id': ClaudeApiRoute('GET', '/org-requests/:id'),
  'GET /users/search?nickname=…': ClaudeApiRoute('GET', '/users/search?nickname=:query'),
  'GET /config': ClaudeApiRoute('GET', '/config'),
  'GET /config/public': ClaudeApiRoute('GET', '/config/public', authenticated: false),
  'GET /rooms/mine': ClaudeApiRoute('GET', '/rooms/mine'),
  'GET /rooms/:id/events': ClaudeApiRoute('GET', '/rooms/:id/events'),
};
