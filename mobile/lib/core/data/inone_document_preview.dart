import 'dart:io';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import 'inone_encrypted_document_store.dart';

typedef InOneNativeFileOpener = Future<OpenResult> Function(
  String path,
  String mimeType,
);

/// Decrypts an account-bound document only into the OS temporary directory and
/// hands it to the platform's native document interaction API.
class InOneDocumentPreview {
  InOneDocumentPreview({
    required InOneEncryptedDocumentStore store,
    Future<Directory> Function()? temporaryDirectory,
    InOneNativeFileOpener? openFile,
  })  : _store = store,
        _temporaryDirectory = temporaryDirectory ?? getTemporaryDirectory,
        _openFile = openFile ??
            ((path, mimeType) => OpenFilex.open(path, type: mimeType));

  final InOneEncryptedDocumentStore _store;
  final Future<Directory> Function() _temporaryDirectory;
  final InOneNativeFileOpener _openFile;

  static const _supportedTypes = {
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/octet-stream',
  };

  Future<bool> open({
    required String ownerUserId,
    required String requestId,
    required String documentId,
    required String filename,
    required String mimeType,
  }) async {
    if (!_supportedTypes.contains(mimeType.toLowerCase())) {
      throw ArgumentError.value(mimeType, 'mimeType', 'Unsupported preview type');
    }

    final plaintext = await _store.read(
      ownerUserId: ownerUserId,
      requestId: requestId,
      documentId: documentId,
      filename: filename,
    );
    final temp = await _temporaryDirectory();
    final directory = Directory(
      '${temp.path}${Platform.pathSeparator}InOne-document-preview',
    );
    await directory.create(recursive: true);
    final leaf = filename.split(RegExp(r'[/\\\\]')).last;
    final safeLeaf = leaf.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final file = File(
      '${directory.path}${Platform.pathSeparator}$documentId-$safeLeaf',
    );

    try {
      await file.writeAsBytes(plaintext, flush: true);
      final result = await _openFile(file.path, mimeType);
      if (result.type == ResultType.done) return true;
      await file.delete();
      return false;
    } catch (_) {
      if (await file.exists()) await file.delete();
      rethrow;
    }
  }

  /// Removes plaintext preview files when the app returns from the native viewer
  /// or logs out. Also called on startup to remove leftovers from a killed process.
  Future<void> clear() async {
    final temp = await _temporaryDirectory();
    final directory = Directory(
      '${temp.path}${Platform.pathSeparator}InOne-document-preview',
    );
    if (await directory.exists()) await directory.delete(recursive: true);
  }
}
