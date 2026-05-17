# Security Policy

## Supported versions

Only the current `main` branch and the latest tagged release receive security fixes.

## Reporting a vulnerability

Email the maintainers with:

- affected commit or version
- impact and exploitability notes
- reproduction steps
- any logs or packet captures needed to validate

Do not include secrets, private keys, or third-party traffic that you are not authorized to share.

## Scope

In scope:

- authentication, authorization, CSRF, CORS, and cookie handling
- sensor gateway authentication
- active-module authorization gates
- audit integrity and append-only behavior
- frontend URL sanitization, report-download safety, and CSP/header posture
- report signing and authenticated report download routes
- dependency, container, and CI supply-chain issues

Out of scope:

- attacks requiring compromised operator credentials and a valid second factor
- denial of service from a local machine with administrative access to the host
- issues in third-party tools unless Cheeky Pony invokes them unsafely

## Security controls

Cheeky Pony is default-deny around offensive WiFi functionality. Lab module starts
and stops require lab mode, an authorized-operator acknowledgement, admin role,
recent TOTP, an active engagement, and an allow-listed target. Successes and
refusals are audited.

The backend rejects known development secrets outside development-like
environments, uses HTTP-only SameSite cookies for JWTs, requires CSRF on
state-changing browser flows, and accepts sensor WebSockets only through the
authenticated mTLS proxy-header path.

The frontend blocks unsafe post-login redirect paths and report download URLs before
they reach browser navigation. The production-style frontend container runs nginx as
an unprivileged user and emits CSP, `nosniff`, referrer, permissions, frame, COOP,
and CORP headers.

## Disclosure timeline

Maintainers aim to acknowledge reports within 5 business days, provide a triage result within 15 business days, and coordinate a fix or mitigation timeline based on severity.
