# Candidate lockfile promotion record

- Source compatibility and RustSec run: [45849153656](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/45849153656)
- Source head tested: `c2a4c9ca18e62ab6d2178f26ff610dfd90a8161d`
- Candidate lockfile SHA-256: `a6ad5ab649c877d6101746d1b03d4cfe34420db9072679fb32bcc6e8d8dd1438`
- Candidate runtime: SQLCipher 4.20.0 / SQLite 3.54.1
- Candidate RustSec result: 0 vulnerability records
- Promotion job: trusted push-only job in `.github/workflows/openmls-sqlcipher-compat-prototype.yml`; it regenerated the lockfile, verified the exact hash, ran `cargo tree --locked`, re-ran RustSec, and committed only the prototype lockfile.

The promoted lockfile is scoped to `development/prototypes/openmls-0.10-sqlcipher-compat/current-reader/`. No production Cargo manifest or lockfile was changed.
