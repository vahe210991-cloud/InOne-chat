# InOne phone web preview

This directory is a mobile-first HTTPS preview shell for the owner-approved HTML UI.

## Scope

- Embeds the existing approved HTML asset without editing or duplicating its source.
- Designed to be opened in a phone browser.
- Visual-only: it does not provide authentication, messaging, task updates, file uploads, notifications, or a live backend connection.
- Do not enter real passwords or personal data.

## Local preview

Serve the repository root with any static HTTP server and open /web-preview/.

The approved UI is loaded from /web-preview/approved/InOne-approved-cross-platform.html.

## GitHub Pages artifact

The InOne phone web preview workflow packages this directory and the original approved HTML asset into a Pages-compatible artifact. Publishing that artifact requires GitHub Pages to be enabled for this private repository and an explicit deployment run. No backend or database is included in the artifact.

Before adding live API access, implement a browser-specific auth/session layer, token storage policy, CORS/CSRF protections, and a staging API origin. The current Flutter WebView bridge and mobile secure-storage implementation are not browser implementations.
