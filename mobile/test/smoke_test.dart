import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/app/inone_mobile_app.dart';
import 'package:inone_mobile/ui_dart_source/inone.dart';

const _secureStorageChannel =
    MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
const _pathProviderChannel = MethodChannel('plugins.flutter.io/path_provider');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('production entry renders the native Dart authentication screen',
      (tester) async {
    final storedValues = <String, String>{};
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      _secureStorageChannel,
      (call) async {
        final arguments = Map<Object?, Object?>.from(
          call.arguments as Map<Object?, Object?>? ?? const {},
        );
        final key = arguments['key'] as String?;

        switch (call.method) {
          case 'read':
            return key == null ? null : storedValues[key];
          case 'write':
            final value = arguments['value'];
            if (key != null && value is String) storedValues[key] = value;
            return null;
          case 'delete':
            if (key != null) storedValues.remove(key);
            return null;
          case 'deleteAll':
            storedValues.clear();
            return null;
          case 'readAll':
            return Map<String, String>.from(storedValues);
          default:
            throw MissingPluginException(
              'Unsupported secure-storage method: ${call.method}',
            );
        }
      },
    );
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      _pathProviderChannel,
      (call) async {
        if (call.method == 'getTemporaryDirectory') return '/tmp/inone-smoke-test';
        throw MissingPluginException('Unsupported path-provider method: ${call.method}');
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        _secureStorageChannel,
        null,
      );
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        _pathProviderChannel,
        null,
      );
    });

    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const InOneMobileApp());

    // Session initialization crosses several asynchronous platform-channel
    // calls. Pump in bounded intervals until the production entry leaves its
    // loading state; a single frame is not enough to complete the channel chain.
    for (var attempt = 0;
        attempt < 50 && find.byType(InOneLoginScreen).evaluate().isEmpty;
        attempt++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(find.byType(InOneLoginScreen), findsOneWidget);
    expect(find.text('Մուտք'), findsOneWidget);
    expect(find.text('Google'), findsOneWidget);
    expect(find.text('Apple'), findsOneWidget);
  });
}
