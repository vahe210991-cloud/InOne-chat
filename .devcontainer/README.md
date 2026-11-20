# InOne development environment

## GitHub Codespaces

The Dev Container runs the current backend from
`inone-development-archive-0.6.0/engine` and an isolated PostgreSQL 18
container. The database is named `inone_dev`; its Docker volume is
`inone-codespaces-db`. It is a disposable development/test database and is
not the PostgreSQL instance running on a developer's Windows computer.

The app container connects to the database using the internal Compose hostname
`db`. The database port is deliberately not published to the host or internet.
The backend starts only after the database healthcheck succeeds and a
connection check confirms the expected development database.

## Local Windows PostgreSQL

Codespaces cannot reach `localhost` on the developer's Windows computer:
inside Codespaces, `localhost` refers to the Codespaces container itself.
Do not expose the Windows PostgreSQL port publicly or create a router/firewall
port-forward just to connect Codespaces.

For local Windows development, run the backend from
`inone-development-archive-0.6.0\engine` in a local terminal and set
`DATABASE_URL` in that terminal to a **dedicated InOne development database**
on the local PostgreSQL 18 instance. Do not point development migrations at
any database containing important or production data. Keep credentials in a
local, untracked environment file or Windows environment variables; never
commit them or paste passwords into issues, pull requests, or chat.

Before connecting, verify locally that PostgreSQL 18 is running and that the
dedicated development database exists. The repository does not create, inspect,
or modify a developer's Windows PostgreSQL instance automatically.

## GitHub Actions

CI creates a fresh ephemeral PostgreSQL 18 service for each workflow run.
It is used only for automated tests and is not a staging database or a source
of legacy InOne records.
