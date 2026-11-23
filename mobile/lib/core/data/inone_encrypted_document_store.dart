import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

/// Stores downloaded organization documents as AES-256-GCM ciphertext.
///
/// The encryption key is kept in platform secure storage (Android Keystore-backed
/// storage / iOS Keychain). Plaintext bytes are held only in memory while saving or
/// reading; the app-support directory contains an authenticated encrypted envelope.
class InOneEncryptedDocumentStore {
  InOneEncryptedDocumentStore({
    FlutterSecureStorage? secureStorage,
    Future<Directory> Function()? rootDirectory,
    Future<String?> Function(String keyName)? readKey,
    Future<void> Function(String keyName, String value)? writeKey,
    Future<void> Function(String keyName)? deleteKey,
    Future<void> Function()? deleteLegacyKey,
  })  : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
        _rootDirectory = rootDirectory ?? getApplicationSupportDirectory,
        _readKeyOverride = readKey,
        _writeKeyOverride = writeKey,
        _deleteKeyOverride = deleteKey,
        _deleteLegacyKeyOverride = deleteLegacyKey;

  static const _keyNamePrefix = 'inone.organization_document_key.v1.';
  static const _legacyKeyName = 'inone.organization_document_key.v1';
  static const List<int> _magic = [0x49, 0x4e, 0x31, 0x44, 0x4f, 0x43, 0x30, 0x31];
  static const _nonceLength = 12;
  static const _macLength = 16;

  final FlutterSecureStorage _secureStorage;
  final Future<Directory> Function() _rootDirectory;
  final Future<String?> Function(String keyName)? _readKeyOverride;
  final Future<void> Function(String keyName, String value)? _writeKeyOverride;
  final Future<void> Function(String keyName)? _deleteKeyOverride;
  final Future<void> Function()? _deleteLegacyKeyOverride;
  final AesGcm _algorithm = AesGcm.with256bits();
  final Map<String, Future<SecretKey>> _keyInFlight = {};
  final Map<String, Future<void>> _ownerQueues = {};

  Future<T> _serializeOwner<T>(String ownerUserId, Future<T> Function() operation) async {
    final previous = _ownerQueues[ownerUserId] ?? Future<void>.value();
    final completed = Completer<void>();
    final tail = completed.future;
    _ownerQueues[ownerUserId] = tail;
    try {
      await previous;
      return await operation();
    } finally {
      completed.complete();
      if (identical(_ownerQueues[ownerUserId], tail)) _ownerQueues.remove(ownerUserId);
    }
  }

  Future<String> _ownerKey(String ownerUserId) async {
    final digest = await Sha256().hash(utf8.encode(ownerUserId));
    final hex = digest.bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
    return hex;
  }

  Future<String> _secureKeyName(String ownerUserId) async =>
      '$_keyNamePrefix${await _ownerKey(ownerUserId)}';

  Future<String?> _readKey(String keyName) =>
      _readKeyOverride?.call(keyName) ?? _secureStorage.read(key: keyName);

  Future<void> _writeKey(String keyName, String value) =>
      _writeKeyOverride?.call(keyName, value) ?? _secureStorage.write(key: keyName, value: value);

  Future<void> _deleteLegacyKey() async {
    final override = _deleteLegacyKeyOverride;
    if (override != null) {
      await override();
      return;
    }
    await _secureStorage.delete(key: _legacyKeyName);
  }

  Future<void> _deleteKey(String keyName) =>
      _deleteKeyOverride?.call(keyName) ?? _secureStorage.delete(key: keyName);

  Future<SecretKey> _loadKey(String ownerUserId) async {
    final keyName = await _secureKeyName(ownerUserId);
    final active = _keyInFlight[keyName];
    if (active != null) return active;
    final operation = _loadKeyOnce(keyName);
    _keyInFlight[keyName] = operation;
    try {
      return await operation;
    } finally {
      if (identical(_keyInFlight[keyName], operation)) _keyInFlight.remove(keyName);
    }
  }

  Future<SecretKey> _loadKeyOnce(String keyName) async {
    var encoded = await _readKey(keyName);
    if (encoded == null) {
      final random = Random.secure();
      final bytes = List<int>.generate(32, (_) => random.nextInt(256));
      encoded = base64Encode(bytes);
      await _writeKey(keyName, encoded);
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
    final safeId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
    if (ownerUserId.trim().isEmpty || ownerUserId.length > 256) {
      throw ArgumentError.value(ownerUserId, 'ownerUserId', 'Invalid document owner');
    }
    if (!safeId.hasMatch(requestId) || !safeId.hasMatch(documentId)) {
      throw ArgumentError('Invalid organization request or document identifier');
    }
    if (filename.trim().isEmpty || filename.length > 180) {
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

  Future<Directory> _ownerDirectory(String ownerUserId) async {
    final root = await _rootDirectory();
    final ownerKey = await _ownerKey(ownerUserId);
    return Directory(
      '${root.path}${Platform.pathSeparator}InOne'
      '${Platform.pathSeparator}organization-documents'
      '${Platform.pathSeparator}$ownerKey',
    );
  }

  Future<File> _file(String ownerUserId, String requestId, String documentId) async {
    final ownerDirectory = await _ownerDirectory(ownerUserId);
    final directory = Directory('${ownerDirectory.path}${Platform.pathSeparator}$requestId');
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
  }) => _serializeOwner(
        ownerUserId,
        () => _save(
          ownerUserId: ownerUserId,
          requestId: requestId,
          documentId: documentId,
          filename: filename,
          bytes: bytes,
        ),
      );

  Future<File> _save({
    required String ownerUserId,
    required String requestId,
    required String documentId,
    required String filename,
    required List<int> bytes,
  }) async {
    _validateIdentity(ownerUserId, requestId, documentId, filename);
    if (bytes.isEmpty) {
      throw ArgumentError.value(bytes, 'bytes', 'Document is empty');
    }

    final secretKey = await _loadKey(ownerUserId);
    final encrypted = await _algorithm.encrypt(
      bytes,
      secretKey: secretKey,
      nonce: _algorithm.newNonce(),
      aad: _aad(ownerUserId, requestId, documentId, filename),
    );
    final envelope = <int>[
      ..._magic,
      ...encrypted.nonce,
      ...encrypted.mac.bytes,
      ...encrypted.cipherText,
    ];
    final file = await _file(ownerUserId, requestId, documentId);
    await file.writeAsBytes(envelope, flush: true);
    return file;
  }

  /// Decrypts only after validating the envelope and authenticating its owner and metadata.
  Future<List<int>> read({
    required String ownerUserId,
    required String requestId,
    required String documentId,
    required String filename,
  }) => _serializeOwner(
        ownerUserId,
        () => _read(
          ownerUserId: ownerUserId,
          requestId: requestId,
          documentId: documentId,
          filename: filename,
        ),
      );

  Future<List<int>> _read({
    required String ownerUserId,
    required String requestId,
    required String documentId,
    required String filename,
  }) async {
    _validateIdentity(ownerUserId, requestId, documentId, filename);
    final file = await _file(ownerUserId, requestId, documentId);
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
      secretKey: await _loadKey(ownerUserId),
      aad: _aad(ownerUserId, requestId, documentId, filename),
    );
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
  }) => _serializeOwner(
        ownerUserId,
        () => _delete(
          ownerUserId: ownerUserId,
          requestId: requestId,
          documentId: documentId,
        ),
      );

  Future<void> _delete({
    required String ownerUserId,
    required String requestId,
    required String documentId,
  }) async {
    final safeId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
    if (!safeId.hasMatch(requestId) || !safeId.hasMatch(documentId)) {
      throw ArgumentError('Invalid organization request or document identifier');
    }
    final file = await _file(ownerUserId, requestId, documentId);
    if (await file.exists()) await file.delete();
  }

  /// Irrevocably removes one account's local document files and its encryption key.
  /// Other accounts on the same installation retain independent keys and files.
  Future<void> purgeAccount(String ownerUserId) =>
      _serializeOwner(ownerUserId, () => _purgeAccount(ownerUserId));

  Future<void> _purgeAccount(String ownerUserId) async {
    if (ownerUserId.trim().isEmpty || ownerUserId.length > 256) {
      throw ArgumentError.value(ownerUserId, 'ownerUserId', 'Invalid document owner');
    }
    final keyName = await _secureKeyName(ownerUserId);
    final active = _keyInFlight[keyName];
    if (active != null) {
      try {
        await active;
      } catch (_) {
        // A failed initialization must not prevent key deletion.
      }
    }
    final failures = <Object>[];
    // Crypto-erase first, but still attempt file deletion if secure storage fails.
    try {
      await _deleteKey(keyName);
    } catch (error) {
      failures.add(error);
    }
    _keyInFlight.remove(keyName);
    try {
      final directory = await _ownerDirectory(ownerUserId);
      if (await directory.exists()) await directory.delete(recursive: true);
    } catch (error) {
      failures.add(error);
    }
    if (failures.isNotEmpty) {
      throw StateError('Account document purge incomplete (${failures.length} failure(s))');
    }
  }

  /// Removes the legacy unscoped key/cache without touching hashed owner directories.
  Future<void> purgeLegacyUnscopedData() async {
    final failures = <Object>[];
    try {
      await _deleteLegacyKey();
    } catch (error) {
      failures.add(error);
    }
    try {
      final root = await _rootDirectory();
      final directory = Directory(
        '${root.path}${Platform.pathSeparator}InOne'
        '${Platform.pathSeparator}organization-documents',
      );
      if (await directory.exists()) {
        await for (final entity in directory.list(followLinks: false)) {
          if (entity is! Directory) continue;
          final name = entity.uri.pathSegments.where((part) => part.isNotEmpty).last;
          final children = await entity.list(followLinks: false).toList();
          final isOwnerScope = RegExp(r'^[0-9a-f]{64}
).hasMatch(name) &&
              children.every((child) => child is Directory);
          if (!isOwnerScope) {
            try {
              await entity.delete(recursive: true);
            } catch (error) {
              failures.add(error);
            }
          }
        }
      }
    } catch (error) {
      failures.add(error);
    }
    if (failures.isNotEmpty) {
      throw StateError('Legacy document cache cleanup incomplete (${failures.length} failure(s))');
    }
  }
}
