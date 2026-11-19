import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:inone_mobile/core/data/inone_encrypted_document_store.dart';

void main() {
  late Directory root;
  late Map<String, String> keys;
  late int keyWrites;
  late bool legacyKeyPresent;
  late InOneEncryptedDocumentStore store;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('inone-documents-');
    keys = {};
    keyWrites = 0;
    legacyKeyPresent = true;
    store = InOneEncryptedDocumentStore(
      rootDirectory: () async => root,
      readKey: (scope) async => keys[scope],
      writeKey: (scope, value) async {
        keyWrites++;
        keys[scope] = value;
      },
      deleteKey: (scope) async { keys.remove(scope); },
      deleteLegacyKey: () async { legacyKeyPresent = false; },
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
    expect(keys, hasLength(1));

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

  test('concurrent first writes share one account-scoped secure key', () async {
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

    expect(keyWrites, 1);
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

  test('isolates account keys and paths and purges only the requested owner', () async {
    final ownerFile = await store.save(
      ownerUserId: 'owner-1',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'owner.pdf',
      bytes: utf8.encode('owner one'),
    );
    final otherFile = await store.save(
      ownerUserId: 'owner-2',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'owner.pdf',
      bytes: utf8.encode('owner two'),
    );
    expect(ownerFile.path, isNot(otherFile.path));
    expect(keys, hasLength(2));

    await store.purgeOwner('owner-1');

    expect(await ownerFile.exists(), isFalse);
    expect(await otherFile.exists(), isTrue);
    expect(keys, hasLength(1));
    expect(
      await store.read(
        ownerUserId: 'owner-2',
        requestId: 'request-1',
        documentId: 'document-1',
        filename: 'owner.pdf',
      ),
      utf8.encode('owner two'),
    );
    await expectLater(
      store.read(
        ownerUserId: 'owner-1',
        requestId: 'request-1',
        documentId: 'document-1',
        filename: 'owner.pdf',
      ),
      throwsA(anything),
    );
  });

  test('purge waits for queued writes and crypto-erases the owner key', () async {
    await Future.wait([
      store.save(
        ownerUserId: 'owner-1',
        requestId: 'request-1',
        documentId: 'document-1',
        filename: 'one.pdf',
        bytes: utf8.encode('first'),
      ),
      store.purgeOwner('owner-1'),
    ]);

    expect(keys, isEmpty);
    final remainingFiles = await root
        .list(recursive: true)
        .where((entity) => entity is File && entity.path.endsWith('.in1doc'))
        .toList();
    expect(remainingFiles, isEmpty);
  });

  test('upgrade cleanup erases legacy global key without deleting owner-scoped data', () async {
    final scopedFile = await store.save(
      ownerUserId: 'owner-1',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'private.pdf',
      bytes: utf8.encode('new scoped data'),
    );
    final legacyDirectory = Directory('${root.path}${Platform.pathSeparator}InOne'
        '${Platform.pathSeparator}organization-documents'
        '${Platform.pathSeparator}legacy-request');
    await legacyDirectory.create(recursive: true);
    final legacyFile = File('${legacyDirectory.path}${Platform.pathSeparator}old.in1doc');
    await legacyFile.writeAsBytes([1, 2, 3]);

    await store.purgeLegacyUnscopedData();

    expect(legacyKeyPresent, isFalse);
    expect(await legacyFile.exists(), isFalse);
    expect(await scopedFile.exists(), isTrue);
    expect(keys, hasLength(1));
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

  test('rejects path-like identifiers, filenames and empty documents', () async {
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
        filename: '../document.pdf',
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
