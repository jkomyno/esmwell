# Security policy

## Supported versions

| Version        | Supported |
| -------------- | --------- |
| Latest release | ✅        |
| Older releases | ❌        |

Security fixes land on `main` and ship in the next release.

## Reporting a vulnerability

Do not open a public issue. Use [GitHub private vulnerability reporting](https://github.com/jkomyno/esmwell/security/advisories/new). If that form is unavailable, email the maintainer address listed in `packages/esmwell/package.json`.

Include affected versions, reproduction steps, impact, and any suggested mitigation. Avoid including secrets or unrelated personal data.

## Scope

esmwell isolates submitted code in browser workers for disposability and timeout recovery. That isolation is not a security boundary, and the package README says so. A report that submitted code can reach browser capabilities the host page allows, such as `fetch`, is expected behavior rather than a vulnerability. A report that submitted code can escape the execution worker into the coordinator, replace a runtime-owned global, or defeat the timeout is in scope.
