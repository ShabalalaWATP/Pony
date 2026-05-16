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
- dependency, container, and CI supply-chain issues

Out of scope:

- attacks requiring compromised operator credentials and a valid second factor
- denial of service from a local machine with administrative access to the host
- issues in third-party tools unless Cheeky Pony invokes them unsafely

## Disclosure timeline

Maintainers aim to acknowledge reports within 5 business days, provide a triage result within 15 business days, and coordinate a fix or mitigation timeline based on severity.
