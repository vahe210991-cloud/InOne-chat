import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/widgets.dart';

import 'app/inone_mobile_app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final supportsPush = Platform.isAndroid || Platform.isIOS;
  if (supportsPush) {
    // Native generation installs the matching client config before compilation.
    await Firebase.initializeApp();
  }
  runApp(InOneMobileApp(enablePush: supportsPush));
}
