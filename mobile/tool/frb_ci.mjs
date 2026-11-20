#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const protectedPaths = [
  'lib/main.dart',
  'rust/src/api/mod.rs',
  'rust/src/api/session.rs',
  'pubspec.yaml',
  'pubspec.lock',
  'rust/Cargo.toml',
  'rust/Cargo.lock',
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' failed with status ' + result.status);
  }
}

function setOf(values) {
  return new Set(values);
}

function sameSet(actual, expected, label) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (a.length !== e.length || a.some((value, index) => value !== e[index])) {
    throw new Error(label + ' mismatch\nactual: ' + a.join(', ') + '\nexpected: ' + e.join(', '));
  }
}

function futureMethods(source) {
  return [...source.matchAll(/^\s*Future<[^;\n]*?>\s+([A-Za-z_]\w*)\s*\(/gm)].map(match => match[1]);
}

function verifyContract() {
  const interfaceSource = fs.readFileSync('lib/core/mls/mls_session_bridge.dart', 'utf8');
  const adapterSource = fs.readFileSync('lib/core/mls/rust_mls_session_bridge.dart', 'utf8');
  const generatedSource = fs.readFileSync('lib/src/rust/api/session.dart', 'utf8');
  const generatedRuntime = fs.readFileSync('lib/src/rust/frb_generated.dart', 'utf8');
  const rustSource = fs.readFileSync('rust/src/api/session.rs', 'utf8');

  const interfaceMethods = futureMethods(interfaceSource);
  const adapterLines = adapterSource.split(/\r?\n/);
  const adapterOverrides = [];
  for (let index = 0; index < adapterLines.length; index++) {
    if (adapterLines[index].trim() !== '@override') continue;
    const match = (adapterLines[index + 1] || '').match(/^\s*Future<[^;\n]*?>\s+([A-Za-z_]\w*)\s*\(/);
    if (match) adapterOverrides.push(match[1]);
  }
  if (new Set(interfaceMethods).size !== interfaceMethods.length) {
    throw new Error('MlsSessionBridge contains duplicate Future method declarations');
  }
  if (new Set(adapterOverrides).size !== adapterOverrides.length) {
    throw new Error('RustMlsSessionBridge contains duplicate Future overrides');
  }
  sameSet(setOf(adapterOverrides), setOf(interfaceMethods), 'Dart interface/adapter method coverage');

  const classStart = generatedSource.indexOf('abstract class MlsSession');
  if (classStart < 0) throw new Error('Generated MlsSession class is missing');
  const classEnd = generatedSource.indexOf('\n                }', classStart);
  if (classEnd < 0) throw new Error('Cannot locate generated MlsSession class boundary');
  const sessionBlock = generatedSource.slice(classStart, classEnd);
  const topLevelBlock = generatedSource.slice(0, classStart);
  const generatedSessionMethods = futureMethods(sessionBlock);
  const generatedTopLevelMethods = futureMethods(topLevelBlock);

  const topLevelMap = {
    open: 'openSession',
    resume: 'resumeSession',
    purgeLocalSession: 'purgeLocalSession',
  };
  const sessionMap = {
    sync: 'syncJson',
    pendingIncoming: 'pendingIncomingJson',
    messagesForRoom: 'messagesForRoomJson',
    undecryptable: 'undecryptableJson',
    outboxLength: 'outboxLen',
  };
  const expectedTopLevel = interfaceMethods
    .filter(name => Object.prototype.hasOwnProperty.call(topLevelMap, name))
    .map(name => topLevelMap[name]);
  const expectedSession = interfaceMethods
    .filter(name => !Object.prototype.hasOwnProperty.call(topLevelMap, name))
    .map(name => sessionMap[name] || name);

  sameSet(setOf(generatedTopLevelMethods), setOf(expectedTopLevel), 'Generated top-level FRB exports');
  sameSet(setOf(generatedSessionMethods), setOf(expectedSession), 'Generated MlsSession exports');

  const adapterCalls = setOf([...adapterSource.matchAll(/\.([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]));
  const rustCalls = setOf([...adapterSource.matchAll(/\brust\.(\w+)\s*\(/g)].map(match => match[1]));
  for (const method of expectedSession) {
    if (!adapterCalls.has(method)) throw new Error('Adapter does not call generated session method ' + method);
  }
  for (const method of expectedTopLevel) {
    if (!rustCalls.has(method)) throw new Error('Adapter does not call generated top-level function rust.' + method);
  }

  const ignoredRustMethods = ['sync', 'pending_incoming', 'welcome_receipt_status_json'];
  for (const method of ignoredRustMethods) {
    const pattern = new RegExp('#\\[frb\\(ignore\\)\\]\\s*pub fn ' + method + '\\s*\\(');
    if (!pattern.test(rustSource)) throw new Error('Rust-only helper ' + method + ' must be marked #[frb(ignore)]');
  }

  const forbiddenGeneratedMethods = ['sync_', 'pendingIncoming', 'welcomeReceiptStatusJson'];
  for (const method of forbiddenGeneratedMethods) {
    const pattern = new RegExp('\\bFuture<[^;\\n]*?>\\s+' + method + '\\s*\\(');
    if (pattern.test(generatedSource)) {
      throw new Error('Unexpected generated Dart method remains: ' + method);
    }
  }
  // Generated FRB files contain explanatory comments that may mention Rust DTO names.
  // Only executable Dart declarations/references are evidence that the DTO leaked into
  // the generated bridge contract; comments must not cause a false-positive failure.
  const generatedCode = generatedSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const incomingMessageTypeExposure =
    /\b(?:class|mixin|enum|typedef)\s+IncomingMessage\b/.test(generatedCode) ||
    /\b(?:Future|List|Stream|Iterable|Option)\s*<[^;\n]*\bIncomingMessage\b/.test(generatedCode);
  if (incomingMessageTypeExposure) {
    throw new Error('Generated Dart API still exposes the Rust-only IncomingMessage type');
  }

  const normalizedSession = sessionBlock.replace(/\s+/g, ' ');
  const requiredTypes = [
    'Future<BigInt> outboxLen(',
    'Future<BigInt> flushOutbox(',
    'Future<BigInt> removeRevokedDevices(',
    'Future<BigInt?> localEpoch(',
    'Future<String?> roomRecoveryStatus(',
    'Future<String?> quarantinedCommitReason(',
    'Future<List<String>> membersOf(',
    'Future<String> syncJson(',
    'Future<String> pendingIncomingJson(',
    'Future<String> messagesForRoomJson(',
    'Future<String> undecryptableJson(',
    'Future<void> ensureKeyPackages({required BigInt target ',
  ];
  for (const signature of requiredTypes) {
    if (!normalizedSession.includes(signature)) {
      throw new Error('Generated Dart type/nullability contract missing: ' + signature);
    }
  }
  if (!/Future<void>\s+init\s*\(/.test(generatedRuntime)) {
    throw new Error('Generated RustLib.init entrypoint is missing');
  }
  if (!/RustLib\.init\s*\(/.test(adapterSource)) {
    throw new Error('Production adapter does not initialize RustLib');
  }

  console.log(
    'FRB contract PASS: interface=' + interfaceMethods.length +
    ', adapter=' + adapterOverrides.length +
    ', generated session exports=' + generatedSessionMethods.length +
    ', generated top-level exports=' + generatedTopLevelMethods.length +
    '; no orphan exports; BigInt/nullability checks passed.'
  );
}

if (process.argv.includes('--verify-only')) {
  verifyContract();
  process.exit(0);
}

const snapshots = new Map(protectedPaths.map(path => [path, fs.readFileSync(path)]));
function restoreProtectedFiles() {
  for (const [path, content] of snapshots) fs.writeFileSync(path, content);
}

try {
  run('flutter_rust_bridge_codegen', [
    'integrate',
    '--rust-crate-dir', 'rust',
    '--rust-crate-name', 'inone_mls_frb',
    '--integration-backend', 'native-assets',
    '--platforms', 'android,ios',
    '--skip-fvm-install',
    '--no-dart-fix',
    '--no-dart-format',
    '--no-integration-test',
  ]);

  restoreProtectedFiles();
  run('flutter', ['pub', 'get', '--enforce-lockfile']);
  run('git', ['diff', '--exit-code', '--', ...protectedPaths]);

  run('flutter_rust_bridge_codegen', [
    'generate',
    '--skip-fvm-install',
    '--no-dart-fix',
    '--no-dart-format',
    '--no-auto-upgrade-dependency',
    '--no-web',
    '--stop-on-error',
  ]);

  fs.rmSync('rust/src/api/simple.rs', { force: true });
  fs.rmSync('lib/src/rust/api/simple.dart', { force: true });
  fs.rmSync('integration_test/simple_test.dart', { force: true });
  fs.rmSync('lib/src/rust/frb_generated.web.dart', { force: true });

  run('cargo', ['fmt', '--manifest-path', 'rust/Cargo.toml']);
  run('cargo', ['fmt', '--manifest-path', 'rust/Cargo.toml', '--', '--check']);
  run('git', ['diff', '--exit-code', '--', ...protectedPaths]);
  verifyContract();
} finally {
  restoreProtectedFiles();
}
