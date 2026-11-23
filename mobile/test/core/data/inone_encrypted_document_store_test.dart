import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_encrypted_document_store.dart';

void main() {
  late Directory root;
  late Map<String, String> storedKeys;
  late InOneEncryptedDocumentStore store;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('inone-documents-');
    storedKeys = <String, String>{};
    store = InOneEncryptedDocumentStore(
      rootDirectory: () async => root,
      readKey: (keyName) async => storedKeys[keyName],
      writeKey: (keyName, value) async => storedKeys[keyName] = value,
      deleteKey: (keyName) async => storedKeys.remove(keyName),
    );
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  test('persists ciphertext only and restores the exact owner-bound document', () async {
    final plaintext = utf8.encode('confidential company registration document');
    final file = await store.save(
      ownerUserId: '@owner:inone.test',
      requestId: 'request-123',
      documentId: 'document-456',
      filename: 'registration.pdf',
      bytes: plaintext,
    );

    expect(await file.exists(), isTrue);
    final ciphertext = await file.readAsBytes();
    expect(base64Encode(ciphertext), isNot(contains(base64Encode(plaintext))));
    expect(ciphertext, isNot(plaintext));
    expect(storedKeys, hasLength(1));

    final restored = await store.read(
      ownerUserId: '@owner:inone.test',
      requestId: 'request-123',
      documentId: 'document-456',
      filename: 'registration.pdf',
    );
    expect(restored, plaintext);

    await expectLater(
      store.read(
        ownerUserId: '@another:inone.test',
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'registration.pdf',
      ),
      throwsA(anything),
      reason: 'encrypted documents are bound to the account owner',
    );
    await expectLater(
      store.read(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'renamed.pdf',
      ),
      throwsA(anything),
      reason: 'the authenticated filename is bound to the encrypted document',
    );
  });

  test('concurrent first writes share one secure key', () async {
    await Future.wait([
      store.save(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-1',
        filename: 'one.pdf',
        bytes: utf8.encode('first document'),
      ),
      store.save(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-2',
        filename: 'two.pdf',
        bytes: utf8.encode('second document'),
      ),
    ]);

    expect(
      await store.read(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-1',
        filename: 'one.pdf',
      ),
      utf8.encode('first document'),
    );
    expect(
      await store.read(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-2',
        filename: 'two.pdf',
      ),
      utf8.encode('second document'),
    );
  });

  test('rejects modified ciphertext instead of returning unauthenticated bytes', () async {
    final file = await store.save(
      ownerUserId: '@owner:inone.test',
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
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'registration.pdf',
      ),
      throwsA(anything),
    );
  });


  test('purges one account key and ciphertext without affecting another account', () async {
    final first = await store.save(
      ownerUserId: '@owner:inone.test',
      requestId: 'request-123',
      documentId: 'document-1',
      filename: 'owner.pdf',
      bytes: utf8.encode('owner private document'),
    );
    final second = await store.save(
      ownerUserId: '@other:inone.test',
      requestId: 'request-123',
      documentId: 'document-2',
      filename: 'other.pdf',
      bytes: utf8.encode('other private document'),
    );
    expect(storedKeys, hasLength(2));

    await store.purgeAccount('@owner:inone.test');

    expect(await first.exists(), isFalse);
    expect(await second.exists(), isTrue);
    expect(storedKeys, hasLength(1));
    await expectLater(
      store.read(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-1',
        filename: 'owner.pdf',
      ),
      throwsA(anything),
    );
    expect(
      await store.read(
        ownerUserId: '@other:inone.test',
        requestId: 'request-123',
        documentId: 'document-2',
        filename: 'other.pdf',
      ),
      utf8.encode('other private document'),
    );
  });

  test('purge waits for an in-flight save and cannot leave a resurrected key or file', () async {
    final save = store.save(
      ownerUserId: '@owner:inone.test',
      requestId: 'request-123',
      documentId: 'document-race',
      filename: 'race.pdf',
      bytes: utf8.encode('race document'),
    );
    final purge = store.purgeAccount('@owner:inone.test');
    await save;
    await purge;

    expect(storedKeys, isEmpty);
    final ownerDirectory = Directory(
      '${root.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-documents',
    );
    if (await ownerDirectory.exists()) {
      expect(await ownerDirectory.list(recursive: true).toList(), isEmpty);
    }
  });

  test('purge still deletes ciphertext when secure-key deletion fails', () async {
    final file = await store.save(
      ownerUserId: '@owner:inone.test',
      requestId: 'request-123',
      documentId: 'document-key-failure',
      filename: 'private.pdf',
      bytes: utf8.encode('private document'),
    );
    final failingStore = InOneEncryptedDocumentStore(
      rootDirectory: () async => root,
      readKey: (keyName) async => storedKeys[keyName],
      writeKey: (keyName, value) async => storedKeys[keyName] = value,
      deleteKey: (_) async => throw StateError('platform key store unavailable'),
    );

    await expectLater(
      failingStore.purgeAccount('@owner:inone.test'),
      throwsA(isA<StateError>()),
    );
    expect(await file.exists(), isFalse);
  });

  test('purge is idempotent when account has no local documents or key', () async {
    await store.purgeAccount('@empty:inone.test');
    await store.purgeAccount('@empty:inone.test');
    expect(storedKeys, isEmpty);
  });

  test('rejects path-like identifiers and empty documents', () async {
    await expectLater(
      store.save(
        ownerUserId: '@owner:inone.test',
        requestId: '../escape',
        documentId: 'document-456',
        filename: 'document.pdf',
        bytes: [1],
      ),
      throwsArgumentError,
    );
    await expectLater(
      store.save(
        ownerUserId: '@owner:inone.test',
        requestId: 'request-123',
        documentId: 'document-456',
        filename: 'document.pdf',
        bytes: const [],
      ),
      throwsArgumentError,
    );
  });
}
