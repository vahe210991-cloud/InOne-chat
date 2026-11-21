import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/widgets.dart';

import 'app/inone_mobile_app.dart';

@pragma('vm:entry-point')
Future<void> inOneFirebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final supportsPush = Platform.isAndroid || Platform.isIOS;
  if (supportsPush) {
    // Native generation installs the matching client config before compilation.
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(inOneFirebaseMessagingBackgroundHandler);
  }
  runApp(InOneMobileApp(enablePush: supportsPush));
}
