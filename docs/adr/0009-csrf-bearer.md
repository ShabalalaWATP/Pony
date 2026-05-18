# ADR-0009: CSRF enforcement for Bearer-authenticated unsafe requests

## Context

The backend accepts access tokens from the `access_token` cookie and from
`Authorization: Bearer ...`. The global CSRF middleware previously enforced
`X-CSRF-Token` only when an access-token cookie was present. A valid Bearer token
on an unsafe `/api/*` request could therefore reach route handlers without the
same CSRF contract.

Browser operators still use cookies as the documented path, and browsers do not
automatically attach Authorization headers cross-origin. The gap was still a
contract violation and a latent risk if Bearer tokens are later issued to scripts
or external tools.

## Decision

Keep the existing global middleware and extend its token lookup to check Bearer
Authorization when the cookie is absent. Unsafe API methods now require a valid
CSRF header whenever the request is authenticated by either supported token path.

The login, registration, and refresh endpoints remain CSRF-exempt because they
are the session-establishment paths.

## Consequences

- Bearer-authenticated API clients must send the JWT-bound CSRF value on unsafe
  methods.
- Existing browser cookie behavior is unchanged.
- CSRF remains a cross-cutting middleware concern rather than being duplicated on
  every protected route.

## Alternatives Considered

- Move CSRF to route dependencies. This would make OpenAPI more explicit, but it
  is a broader router refactor and easier to miss on newly added routes.
- Drop Bearer support. That would reduce surface area, but existing dependency
  behavior already supports it and other tests rely on it.
- Keep cookie-only CSRF enforcement. Rejected because it preserves the audited
  contract gap.
