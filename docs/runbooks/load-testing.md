# Backend Load Testing

Use the Locust profile in `tests/load/locustfile.py` to exercise the backend REST
and operator WebSocket paths under sustained local or staging load. Do not run it
against production data.

## Preconditions

1. Start the backend stack:

   ```shell
   make up
   ```

2. Seed useful read-path data and optional live WebSocket traffic:

   ```shell
   make seed-demo
   make seed-demo-stream
   ```

3. Create or choose a dedicated admin user and complete TOTP setup. Export the
   load-test credentials:

   ```shell
   export CHEEKY_PONY_LOAD_EMAIL=admin@example.com
   export CHEEKY_PONY_LOAD_PASSWORD='replace-with-local-password'
   export CHEEKY_PONY_LOAD_TOTP_SECRET='replace-with-local-secret'
   ```

The TOTP secret is needed for `/api/v1/audit` reads and the `LabAdmin` lifecycle.
Without it, admin-only tasks stop instead of generating repeated 403s.

## Run

The default run uses 50 users, a spawn rate of 5 users/s, and a 10-minute
duration against `http://localhost:8000`:

```shell
make load-test
```

Override the target or run envelope with Make variables:

```shell
LOAD_HOST=http://localhost:8000 LOAD_USERS=50 LOAD_SPAWN_RATE=5 LOAD_RUN_TIME=10m make load-test
```

On Windows without `make`, run the equivalent command:

```powershell
.venv\Scripts\python.exe -m locust -f tests/load/locustfile.py --headless -H http://localhost:8000 -u 50 -r 5 --run-time 10m
```

## Scenarios

- `LoginUser`: maintains one low-rate login/refresh stream and reads cheap
  session-backed endpoints.
- `ListReader`: pages through access points, devices, events, alerts,
  engagements, and audit at a steady cadence.
- `WsListener`: opens `/ws/operator`, stays connected, and records receive or
  idle intervals. Pair with `make seed-demo-stream` to produce live messages.
- `LabAdmin`: one fixed admin user creates an engagement, adds three allow-list
  entries, and ends it with a 12-20s wait between loops.

The profile caches one authenticated session per Locust process to avoid turning
a 50-user run into a credential-stuffing test against the auth rate limiter.

## Session Cookie Shortcut

For long runs where you want to avoid any setup login, provide cookies directly:

```shell
export CHEEKY_PONY_LOAD_ACCESS_TOKEN='access-token-cookie-value'
export CHEEKY_PONY_LOAD_REFRESH_TOKEN='refresh-token-cookie-value'
export CHEEKY_PONY_LOAD_CSRF_TOKEN='csrf-token-cookie-value'
```

Direct cookie mode skips automatic TOTP verification, so admin-only tasks do not
run unless the cached user record already has a recent TOTP verification.

## Baseline

Record baselines on a stable machine before each major release. Use the default
50-user run after `make seed-demo`; run `make seed-demo-stream` in another shell
when measuring WebSocket receive rates.

| Date | Target | Dataset | Users | Duration | Req/s | p95 HTTP | Error rate | Notes |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| 2026-05-19 | local in-memory smoke | empty | 50 | 1m | 150.85 | 58 ms | 0.00% | Profile smoke only; record compose + seeded-data numbers on a stable runner. |

Treat regressions as suspicious when p95 latency doubles, the error rate exceeds
1% outside deliberate 404/409 probes, or operator WebSocket receive failures
appear while `seed-demo-stream` is running.
