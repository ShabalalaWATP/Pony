# Load Test Profile

`locustfile.py` contains the backend/operator-WebSocket profile used by
`make load-test`.

Recommended baseline command:

```shell
CHEEKY_PONY_LOAD_EMAIL=admin@example.com \
CHEEKY_PONY_LOAD_PASSWORD='replace-with-local-password' \
CHEEKY_PONY_LOAD_TOTP_SECRET='replace-with-local-secret' \
LOAD_USERS=50 LOAD_SPAWN_RATE=5 LOAD_RUN_TIME=10m \
make load-test
```

Run it against a seeded local stack and update the table in
`docs/runbooks/load-testing.md` before major releases.
