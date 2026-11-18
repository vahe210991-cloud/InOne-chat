import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_encrypted_document_store.dart';

void main() {
  late Directory root;
  late String? storedKey;
  late InOneEncryptedDocumentStore store;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('inone-documents-');
    storedKey = null;
    store = InOneEncryptedDocumentStore(
      rootDirectory: () async => root,
      readKey: () async => storedKey,
      writeKey: (value) async => storedKey = value,
    );
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  test('persists ciphertext only and restores the exact document with AES-GCM', () async {
    final plaintext = utf8.encode('confidential company registration document');
    final file = await store.save(
      requestId: 'request-123',
      documentId: 'document-456',
      filename: 'registration.pdf',
      bytes: plaintext,
    );

    expect(await file.exists(), isTrue);
    final ciphertext = await file.readAsBytes();
    expect(base64Encode(ciphertext), isNot(contains(base64Encode(plaintext))));
    expect(ciphertext, isNot(plaintext));
    expect(storedKey, isNotNull);

    final restored = await store.read(
      requestId: 'request-123',
      documentId: 'document-456',
      filename: 'registration.pdf',
    );
    expect(restored, plaintext);
    await expectLater(
      store.read(
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'renamed.pdf',
      ),
      throwsA(anything),
      reason: 'the authenticated filename is bound to the encrypted document',
    );
  });

  test('rejects modified ciphertext instead of returning unauthenticated bytes', () async {
    final file = await store.save(
      requestId: 'request-123',
      documentId: 'document-456',
      filename: 'registration.pdf',
      bytes: utf8.encode('confidential document'),
    );
    final encrypted = await file.readAsBytes();
    encrypted[encrypted.length - 1] ^= 0x01;
    await file.writeAsBytes(encrypted, flush: true);

    await expectLater(
      store.read(
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'registration.pdf',
      ),
      throwsA(anything),
    );
  });

  test('rejects path-like identifiers and empty documents', () async {
    await expectLater(
      store.save(
        requestId: '../escape',
        documentId: 'document-456',
        filename: 'document.pdf',
        bytes: [1],
      ),
      throwsArgumentError,
    );
    await expectLater(
      store.save(
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'document.pdf',
        bytes: const [],
      ),
      throwsArgumentError,
    );
  });
}
