import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:open_filex/open_filex.dart';
import 'package:inone_mobile/core/data/inone_document_preview.dart';
import 'package:inone_mobile/core/data/inone_encrypted_document_store.dart';

void main() {
  late Directory root;
  late String? key;
  late InOneEncryptedDocumentStore store;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('inone-preview-');
    key = null;
    store = InOneEncryptedDocumentStore(
      rootDirectory: () async => root,
      readKey: (_) async => key,
      writeKey: (_, value) async => key = value,
      deleteKey: (_) async => key = null,
    );
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  test('decrypts only to temporary preview and opens via native handler', () async {
    const plaintext = 'private PDF bytes';
    await store.save(
      ownerUserId: 'owner-1',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'registration.pdf',
      bytes: utf8.encode(plaintext),
    );
    var openedPath = '';
    var openedMime = '';
    final preview = InOneDocumentPreview(
      store: store,
      temporaryDirectory: () async => root,
      openFile: (path, mime) async {
        openedPath = path;
        openedMime = mime;
        expect(await File(path).readAsString(), plaintext);
        return OpenResult(type: ResultType.done);
      },
    );

    expect(await preview.open(
      ownerUserId: 'owner-1',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'registration.pdf',
      mimeType: 'application/pdf',
    ), isTrue);
    expect(openedMime, 'application/pdf');
    expect(await File(openedPath).exists(), isTrue);

    await preview.clear();
    expect(await File(openedPath).exists(), isFalse);
    final encrypted = await root
        .list(recursive: true)
        .where((entity) => entity is File && entity.path.endsWith('.in1doc'))
        .cast<File>()
        .first;
    expect(await encrypted.readAsString(), isNot(plaintext));
  });

  test('removes plaintext when native handler cannot open the document', () async {
    await store.save(
      ownerUserId: 'owner-1',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'registration.pdf',
      bytes: utf8.encode('private PDF bytes'),
    );
    String? openedPath;
    final preview = InOneDocumentPreview(
      store: store,
      temporaryDirectory: () async => root,
      openFile: (path, _) async {
        openedPath = path;
        return OpenResult(type: ResultType.noAppToOpen);
      },
    );

    expect(await preview.open(
      ownerUserId: 'owner-1',
      requestId: 'request-1',
      documentId: 'document-1',
      filename: 'registration.pdf',
      mimeType: 'application/pdf',
    ), isFalse);
    expect(await File(openedPath!).exists(), isFalse);
  });

  test('rejects unsupported preview MIME types before decrypting', () async {
    final preview = InOneDocumentPreview(
      store: store,
      temporaryDirectory: () async => root,
      openFile: (_, __) async => OpenResult(type: ResultType.done),
    );
    await expectLater(
      preview.open(
        ownerUserId: 'owner-1',
        requestId: 'request-1',
        documentId: 'document-1',
        filename: 'document.exe',
        mimeType: 'application/x-msdownload',
      ),
      throwsArgumentError,
    );
  });
}
