# Security policy

Signet is pre-release software. Do not treat browser-side authorization as a security boundary. Every privileged operation must be authenticated, authorized, validated, and idempotency-protected by the backend that performs it.

## Supported versions

Signet has not published a stable release. Security fixes are made against the latest
code on `main`; older commits are not maintained as supported release lines.

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/kartik-hegde/signet/security/advisories/new)
instead of opening a public issue. Include a minimal reproduction, affected versions,
and impact when possible. Do not include live credentials or data belonging to other
people.
