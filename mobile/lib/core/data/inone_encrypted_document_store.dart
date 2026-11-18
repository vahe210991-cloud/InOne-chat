import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

/// Stores downloaded organization documents as AES-256-GCM ciphertext.
///
/// The encryption key is kept in the platform secure store (Android Keystore-backed
/// storage / iOS Keychain). Plaintext bytes are only held in memory while saving or
/// reading; the app-support directory contains an authenticated encrypted envelope.
class InOneEncryptedDocumentStore {
  InOneEncryptedDocumentStore({
    FlutterSecureStorage? secureStorage,
    Future<Directory> Function()? rootDirectory,
    Future<String?> Function()? readKey,
    Future<void> Function(String value)? writeKey,
  })  : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
        _rootDirectory = rootDirectory ?? getApplicationSupportDirectory,
        _readKeyOverride = readKey,
        _writeKeyOverride = writeKey;

  static const _keyName = 'inone.organization_document_key.v1';
  static const List<int> _magic = [0x49, 0x4e, 0x31, 0x44, 0x4f, 0x43, 0x30, 0x31];
  static const _nonceLength = 12;
  static const _macLength = 16;

  final FlutterSecureStorage _secureStorage;
  final Future<Directory> Function() _rootDirectory;
  final Future<String?> Function()? _readKeyOverride;
  final Future<void> Function(String value)? _writeKeyOverride;
  final AesGcm _algorithm = AesGcm.with256bits();

  Future<String?> _readKey() =>
      _readKeyOverride?.call() ?? _secureStorage.read(key: _keyName);

  Future<void> _writeKey(String value) =>
      _writeKeyOverride?.call(value) ?? _secureStorage.write(key: _keyName, value: value);

  Future<SecretKey> _loadKey() async {
    var encoded = await _readKey();
    if (encoded == null) {
      final random = Random.secure();
      final bytes = List<int>.generate(32, (_) => random.nextInt(256));
      encoded = base64Encode(bytes);
      await _writeKey(encoded);
    }
    final bytes = base64Decode(encoded);
    if (bytes.length != 32) {
      throw StateError('Stored organization document key has an invalid length');
    }
    return SecretKey(bytes);
  }

  void _validateIdentity(String requestId, String documentId, String filename) {
    final safeId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
    if (!safeId.hasMatch(requestId) || !safeId.hasMatch(documentId)) {
      throw ArgumentError('Invalid organization request or document identifier');
    }
    if (filename.trim().isEmpty || filename.length > 180) {
      throw ArgumentError.value(filename, 'filename', 'Invalid document filename');
    }
  }

  List<int> _aad(String requestId, String documentId, String filename) =>
      utf8.encode('InOne|organization-document|v1|$requestId|$documentId|$filename');

  Future<File> _file(String requestId, String documentId) async {
    final root = await _rootDirectory();
    final directory = Directory(
      '${root.path}${Platform.pathSeparator}InOne${Platform.pathSeparator}organization-documents${Platform.pathSeparator}$requestId',
    );
    await directory.create(recursive: true);
    return File('${directory.path}${Platform.pathSeparator}$documentId.in1doc');
  }

  /// Encrypts [bytes] before any file write. The returned file contains ciphertext only.
  Future<File> save({
    required String requestId,
    required String documentId,
    required String filename,
    required List<int> bytes,
  }) async {
    _validateIdentity(requestId, documentId, filename);
    if (bytes.isEmpty) throw ArgumentError.value(bytes, 'bytes', 'Document is empty');

    final secretKey = await _loadKey();
    final nonce = _algorithm.newNonce();
    final encrypted = await _algorithm.encrypt(
      bytes,
      secretKey: secretKey,
      nonce: nonce,
      aad: _aad(requestId, documentId, filename),
    );
    final envelope = <int>[
      ..._magic,
      ...encrypted.nonce,
      ...encrypted.mac.bytes,
      ...encrypted.cipherText,
    ];
    final file = await _file(requestId, documentId);
    await file.writeAsBytes(envelope, flush: true);
    return file;
  }

  /// Decrypts only after validating the envelope and authenticating its request/document binding.
  Future<List<int>> read({
    required String requestId,
    required String documentId,
    required String filename,
  }) async {
    _validateIdentity(requestId, documentId, filename);
    final file = await _file(requestId, documentId);
    final envelope = await file.readAsBytes();
    final minimumLength = _magic.length + _nonceLength + _macLength + 1;
    if (envelope.length < minimumLength ||
        !_matchesMagic(envelope)) {
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
    final plaintext = await _algorithm.decrypt(
      secretBox,
      secretKey: await _loadKey(),
      aad: _aad(requestId, documentId, filename),
    );
    return plaintext;
  }

  bool _matchesMagic(List<int> envelope) {
    for (var i = 0; i < _magic.length; i++) {
      if (envelope[i] != _magic[i]) return false;
    }
    return true;
  }

  Future<void> delete({
    required String requestId,
    required String documentId,
  }) async {
    final safeId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
    if (!safeId.hasMatch(requestId) || !safeId.hasMatch(documentId)) {
      throw ArgumentError('Invalid organization request or document identifier');
    }
    final file = await _file(requestId, documentId);
    if (await file.exists()) await file.delete();
  }
}
