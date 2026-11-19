import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

/// Stores organization documents as owner-scoped AES-256-GCM ciphertext.
///
/// Each account has an independent secure-storage key and directory. All
/// operations for one account are serialized so a purge cannot race a write.
class InOneEncryptedDocumentStore {
  InOneEncryptedDocumentStore({
    FlutterSecureStorage? secureStorage,
    Future<Directory> Function()? rootDirectory,
    Future<String?> Function(String ownerScope)? readKey,
    Future<void> Function(String ownerScope, String value)? writeKey,
    Future<void> Function(String ownerScope)? deleteKey,
  })  : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
        _rootDirectory = rootDirectory ?? getApplicationSupportDirectory,
        _readKeyOverride = readKey,
        _writeKeyOverride = writeKey,
        _deleteKeyOverride = deleteKey;

  static const _keyName = 'inone.organization_document_key.v1';
  static const List<int> _magic = [0x49, 0x4e, 0x31, 0x44, 0x4f, 0x43, 0x30, 0x31];
  static const _nonceLength = 12;
  static const _macLength = 16;

  final FlutterSecureStorage _secureStorage;
  final Future<Directory> Function() _rootDirectory;
  final Future<String?> Function(String ownerScope)? _readKeyOverride;
  final Future<void> Function(String ownerScope, String value)? _writeKeyOverride;
  final Future<void> Function(String ownerScope)? _deleteKeyOverride;
  final AesGcm _algorithm = AesGcm.with256bits();
  final Map<String, Future<void>> _ownerQueues = {};

  Future<String> _ownerScope(String ownerUserId) async {
    _validateOwner(ownerUserId);
    final digest = await Sha256().hash(utf8.encode(ownerUserId));
    return base64UrlEncode(digest.bytes).replaceAll('=', '');
  }

  void _validateOwner(String ownerUserId) {
    if (ownerUserId.trim().isEmpty || ownerUserId.length > 256) {
      throw ArgumentError.value(ownerUserId, 'ownerUserId', 'Invalid document owner');
    }
  }

  Future<T> _withOwnerLock<T>(
    String ownerUserId,
    Future<T> Function(String ownerScope) operation,
  ) async {
    final scope = await _ownerScope(ownerUserId);
    final previous = _ownerQueues[scope] ?? Future<void>.value();
    final release = Completer<void>();
    _ownerQueues[scope] = release.future;
    await previous;
    try {
      return await operation(scope);
    } finally {
      release.complete();
      if (identical(_ownerQueues[scope], release.future)) {
        _ownerQueues.remove(scope);
      }
    }
  }

  Future<String?> _readKey(String scope) =>
      _readKeyOverride?.call(scope) ??
      _secureStorage.read(key: '$_keyName.$scope');

  Future<void> _writeKey(String scope, String value) =>
      _writeKeyOverride?.call(scope, value) ??
      _secureStorage.write(key: '$_keyName.$scope', value: value);

  Future<void> _deleteKey(String scope) =>
      _deleteKeyOverride?.call(scope) ??
      _secureStorage.delete(key: '$_keyName.$scope');

  Future<SecretKey> _loadKey(String scope) async {
    var encoded = await _readKey(scope);
    if (encoded == null) {
      final random = Random.secure();
      final bytes = List<int>.generate(32, (_) => random.nextInt(256));
      encoded = base64Encode(bytes);
      await _writeKey(scope, encoded);
    }
    final bytes = base64Decode(encoded);
    if (bytes.length != 32) {
      throw StateError('Stored organization document key has an invalid length');
    }
    return SecretKey(bytes);
  }

  void _validateIdentity(
    String ownerUserId,
    String requestId,
    String documentId,
    String filename,
  ) {
    _validateOwner(ownerUserId);
    final safeId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
    if (!safeId.hasMatch(requestId) || !safeId.hasMatch(documentId)) {
      throw ArgumentError('Invalid organization request or document identifier');
    }
    if (filename.trim().isEmpty || filename.length > 180 ||
        filename.contains('/') || filename.contains(String.fromCharCode(92))) {
      throw ArgumentError.value(filename, 'filename', 'Invalid document filename');
    }
  }

  List<int> _aad(
    String ownerUserId,
    String requestId,
    String documentId,
    String filename,
  ) =>
      utf8.encode(
        'InOne|organization-document|v1|$ownerUserId|$requestId|$documentId|$filename',
      );

  Future<File> _file(
    String ownerScope,
    String requestId,
    String documentId,
  ) async {
    final root = await _rootDirectory();
    final directory = Directory(
      '${root.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-documents'
      '${Platform.pathSeparator}$ownerScope'
      '${Platform.pathSeparator}$requestId',
    );
    await directory.create(recursive: true);
    return File(
      '${directory.path}${Platform.pathSeparator}$documentId.in1doc',
    );
  }

  /// Encrypts [bytes] before any file write. The returned file contains ciphertext only.
  Future<File> save({
    required String ownerUserId,
    required String requestId,
    required String documentId,
    required String filename,
    required List<int> bytes,
  }) {
    _validateIdentity(ownerUserId, requestId, documentId, filename);
    if (bytes.isEmpty) {
      throw ArgumentError.value(bytes, 'bytes', 'Document is empty');
    }
    return _withOwnerLock(ownerUserId, (scope) async {
      final encrypted = await _algorithm.encrypt(
        bytes,
        secretKey: await _loadKey(scope),
        nonce: _algorithm.newNonce(),
        aad: _aad(ownerUserId, requestId, documentId, filename),
      );
      final envelope = <int>[
        ..._magic,
        ...encrypted.nonce,
        ...encrypted.mac.bytes,
        ...encrypted.cipherText,
      ];
      final file = await _file(scope, requestId, documentId);
      await file.writeAsBytes(envelope, flush: true);
      return file;
    });
  }

  /// Decrypts only after validating the envelope and authenticating owner + metadata.
  Future<List<int>> read({
    required String ownerUserId,
    required String requestId,
    required String documentId,
    required String filename,
  }) {
    _validateIdentity(ownerUserId, requestId, documentId, filename);
    return _withOwnerLock(ownerUserId, (scope) async {
      final file = await _file(scope, requestId, documentId);
      final envelope = await file.readAsBytes();
      final minimumLength = _magic.length + _nonceLength + _macLength + 1;
      if (envelope.length < minimumLength || !_matchesMagic(envelope)) {
        throw const FormatException('Invalid encrypted organization document');
      }

      final nonceStart = _magic.length;
      final macStart = nonceStart + _nonceLength;
      final cipherStart = macStart + _macLength;
      final secretBox = SecretBox(
        envelope.sublist(cipherStart),
        nonce: envelope.sublist(nonceStart, macStart),
        mac: Mac(envelope.sublist(macStart, cipherStart)),
      );
      return _algorithm.decrypt(
        secretBox,
        secretKey: await _loadKey(scope),
        aad: _aad(ownerUserId, requestId, documentId, filename),
      );
    });
  }

  bool _matchesMagic(List<int> envelope) {
    for (var i = 0; i < _magic.length; i++) {
      if (envelope[i] != _magic[i]) return false;
    }
    return true;
  }

  Future<void> delete({
    required String ownerUserId,
    required String requestId,
    required String documentId,
  }) {
    _validateOwner(ownerUserId);
    final safeId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
    if (!safeId.hasMatch(requestId) || !safeId.hasMatch(documentId)) {
      throw ArgumentError('Invalid organization request or document identifier');
    }
    return _withOwnerLock(ownerUserId, (scope) async {
      final file = await _file(scope, requestId, documentId);
      if (await file.exists()) await file.delete();
    });
  }

  /// Crypto-erases one account's key, then removes all of its cached documents.
  /// Other accounts on this installation retain their independent keys and files.
  Future<void> purgeOwner(String ownerUserId) {
    _validateOwner(ownerUserId);
    return _withOwnerLock(ownerUserId, (scope) async {
      await _deleteKey(scope);
      final root = await _rootDirectory();
      final directory = Directory(
        '${root.path}${Platform.pathSeparator}InOne'
        '${Platform.pathSeparator}organization-documents'
        '${Platform.pathSeparator}$scope',
      );
      if (await directory.exists()) await directory.delete(recursive: true);
    });
  }
}
