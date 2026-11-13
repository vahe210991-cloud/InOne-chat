# InOne Identity service

This directory is reserved for the Stage 1 executable Identity service.

Stage 0 delivers technical decisions and contracts under architecture/identity/. No runtime source, package manifest, migrations, Dockerfile or deployment definition is created in this stage.

Before Stage 1, read:
1. architecture/IDENTITY-STAGE-0-READINESS-PACK-V0.1.md
2. architecture/identity/ADR-001-RUNTIME-AND-IDENTITY-PROTOCOL.md
3. architecture/identity/contracts/
4. architecture/identity/ops/ENVIRONMENT-CONTRACT.md
5. architecture/IDENTITY-THREAT-MODEL-AND-IMPLEMENTATION-PLAN-V0.1.md
6. architecture/IDENTITY-RECOVERY-FLOW-V0.1.md

Use a dedicated PostgreSQL database. Never access InOne Business or Propo databases directly.
