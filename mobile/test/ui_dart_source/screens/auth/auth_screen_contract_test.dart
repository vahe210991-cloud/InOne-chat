import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../../../lib/ui_dart_source/screens/auth/sc01_login_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc02_register_email_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc03_email_code_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc04_create_account_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc07_recovery_start_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc09_new_password_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc10_not_you_screen.dart';
import '../../../../lib/ui_dart_source/screens/auth/sc12_logout_screen.dart';

void main() {
  testWidgets('SC-01 submits email and password to the host callback', (tester) async {
    String? submittedEmail;
    String? submittedPassword;
    await tester.pumpWidget(MaterialApp(
      home: InOneLoginScreen(
        onSubmit: (email, password) async {
          submittedEmail = email;
          submittedPassword = password;
          return null;
        },
        onProvider: (_) async => null,
        onRegister: () {},
        onForgotPassword: () {},
      ),
    ));

    await tester.enterText(find.byType(TextField).at(0), ' person@example.test ');
    await tester.enterText(find.byType(TextField).at(1), 'correct-horse-battery');
    await tester.tap(find.text('Մուտք գործել'));
    await tester.pumpAndSettle();

    expect(submittedEmail, 'person@example.test');
    expect(submittedPassword, 'correct-horse-battery');
  });

  testWidgets('SC-02 sends the registration email through its host callback', (tester) async {
    String? submittedEmail;
    var advanced = false;
    await tester.pumpWidget(MaterialApp(
      home: InOneRegisterEmailScreen(
        onSubmit: (email) async {
          submittedEmail = email;
          return null;
        },
        onBack: () {},
        onHaveAccount: () {},
        onDone: () => advanced = true,
      ),
    ));

    await tester.enterText(find.byType(TextField), ' person@example.test ');
    await tester.tap(find.text('Ուղարկել կոդը'));
    await tester.pumpAndSettle();

    expect(submittedEmail, 'person@example.test');
    expect(advanced, isTrue);
  });

  testWidgets('SC-03 confirms a six-digit email code and exposes resend', (tester) async {
    String? submittedCode;
    var resent = false;
    await tester.pumpWidget(MaterialApp(
      home: InOneEmailCodeScreen(
        onConfirm: (code) async {
          submittedCode = code;
          return null;
        },
        onResend: () async {
          resent = true;
          return null;
        },
        onBack: () {},
      ),
    ));

    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.text('Հաստատել'));
    await tester.pumpAndSettle();
    expect(submittedCode, '123456');

    await tester.tap(find.text('Կրկին ուղարկել կոդը'));
    await tester.pumpAndSettle();
    expect(resent, isTrue);
  });

  testWidgets('SC-04 submits nickname password and phone to account creation', (tester) async {
    String? nickname;
    String? password;
    String? phone;
    await tester.pumpWidget(MaterialApp(
      home: InOneCreateAccountScreen(
        onSubmit: (value, secret, number) async {
          nickname = value;
          password = secret;
          phone = number;
          return null;
        },
        onBack: () {},
      ),
    ));

    await tester.enterText(find.byType(TextField).at(0), 'newmember');
    await tester.enterText(find.byType(TextField).at(1), 'correct-horse-battery');
    await tester.enterText(find.byType(TextField).at(2), '+37499123456');
    await tester.tap(find.text('Ստեղծել հաշիվ'));
    await tester.pumpAndSettle();

    expect(nickname, 'newmember');
    expect(password, 'correct-horse-battery');
    expect(phone, '+37499123456');
  });

  testWidgets('SC-07 starts recovery and exposes the code-entry transition', (tester) async {
    String? submittedEmail;
    var enteredCode = false;
    await tester.pumpWidget(MaterialApp(
      home: InOneRecoveryStartScreen(
        onSubmit: (email) async {
          submittedEmail = email;
          return null;
        },
        onBack: () {},
        onEnterCode: () => enteredCode = true,
      ),
    ));

    await tester.enterText(find.byType(TextField), 'person@example.test');
    await tester.tap(find.text('Վերականգնել'));
    await tester.pumpAndSettle();
    expect(submittedEmail, 'person@example.test');

    await tester.tap(find.text('Մուտքագրել նամակի կոդը'));
    await tester.pumpAndSettle();
    expect(enteredCode, isTrue);
  });

  testWidgets('SC-09 submits recovery code, new password and optional PIN', (tester) async {
    String? code;
    String? password;
    String? pin;
    await tester.pumpWidget(MaterialApp(
      home: InOneNewPasswordScreen(
        keyResetWarning: 'Encryption keys will be reset.',
        onSubmit: (value, secret, pinValue) async {
          code = value;
          password = secret;
          pin = pinValue;
          return null;
        },
      ),
    ));

    await tester.enterText(find.byType(TextField).at(0), '123456');
    await tester.enterText(find.byType(TextField).at(1), 'new-secure-password');
    await tester.enterText(find.byType(TextField).at(2), '654321');
    await tester.tap(find.text('Պահպանել'));
    await tester.pumpAndSettle();

    expect(code, '123456');
    expect(password, 'new-secure-password');
    expect(pin, '654321');
  });

  testWidgets('SC-10 submits email and cancellation code', (tester) async {
    String? email;
    String? code;
    await tester.pumpWidget(MaterialApp(
      home: InOneNotYouScreen(
        onSubmit: (value, oneTimeCode) async {
          email = value;
          code = oneTimeCode;
          return null;
        },
        onBack: () {},
      ),
    ));

    await tester.enterText(find.byType(TextField).at(0), 'person@example.test');
    await tester.enterText(find.byType(TextField).at(1), '123456');
    await tester.tap(find.text('Չեղարկել'));
    await tester.pumpAndSettle();

    expect(email, 'person@example.test');
    expect(code, '123456');
  });

  testWidgets('SC-12 delegates logout to the host session', (tester) async {
    var loggedOut = false;
    await tester.pumpWidget(MaterialApp(
      home: InOneLogoutScreen(
        onLogout: () async {
          loggedOut = true;
          return null;
        },
        onCancel: () {},
      ),
    ));

    await tester.tap(find.text('Դուրս գալ'));
    await tester.pumpAndSettle();

    expect(loggedOut, isTrue);
  });
}
