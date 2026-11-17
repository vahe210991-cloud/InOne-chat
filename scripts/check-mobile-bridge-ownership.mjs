#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const cargo = read('mobile/rust/Cargo.toml');
const lib = read('mobile/rust/src/lib.rs');
const api = read('mobile/rust/src/api/session.rs');
const workflow = read('.github/workflows/openmls-frb-codegen.yml');
const mobileRust = resolve(root, 'mobile/rust');

const dependency = cargo.match(/^mls-client\s*=\s*\{\s*path\s*=\s*"([^"]+)"/mu)?.[1] ?? null;
const generated = ['build.rs', 'Cargo.lock', 'src/frb_generated.rs']
  .map((file) => ({ file, present: existsSync(resolve(mobileRust, file)) }));
const report = {
  flutterRustBridgeCrate: cargo.match(/^name\s*=\s*"([^"]+)"/mu)?.[1] ?? null,
  canonicalMlsClientPath: dependency,
  canonicalMlsClientDependency: dependency === '../../inone-engine-poc-0.6.0/mobile-mls/mls-client',
  standaloneMlsBridgeIsDependency: /mls-bridge\s*=/.test(cargo),
  frbOpaqueSession: /#\[frb\(opaque\)\]/u.test(api),
  rustApiExported: /pub mod api;/u.test(lib),
  workflowCrateDir: workflow.match(/--rust-crate-dir[\s\\]+([A-Za-z0-9_-]+)/u)?.[1] ?? null,
  workflowCrateName: workflow.match(/--rust-crate-name[\s\\]+([A-Za-z0-9_-]+)/u)?.[1] ?? null,
  generatedArtifacts: generated,
  generatedArtifactState: generated.every((item) => item.present) ? 'PRESENT' : 'CODEGEN_NOT_MATERIALIZED',
  conclusion: 'mobile/rust is the Flutter FRB boundary; it links the persistent mls-client crate from the POC tree. The inone-engine-poc-0.6.0/mobile-mls/mls-bridge crate is not a dependency of this Flutter crate and must not be treated as its active bridge.',
};
const ok = report.canonicalMlsClientDependency &&
  !report.standaloneMlsBridgeIsDependency &&
  report.frbOpaqueSession &&
  report.rustApiExported &&
  report.workflowCrateDir === 'rust' &&
  report.workflowCrateName === 'inone_mls_frb';
process.stdout.write(JSON.stringify(report, null, 2) + String.fromCharCode(10));
if (!ok) process.exitCode = 1;
