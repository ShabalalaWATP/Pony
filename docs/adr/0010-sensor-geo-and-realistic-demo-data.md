# ADR-0010: Sensor geolocation and realistic demo data

## Context

The map and reconnaissance views need demo records that look like an urban WiFi
environment without requiring a Raspberry Pi. Existing demo AP coordinates are
useful, but sensors still lacked positions and synthetic SSIDs/probes were too
obviously generated to exercise operator judgement.

## Decision

Add optional `latitude`, `longitude`, and `location_source` fields to `Sensor`
records. The fields are nullable so existing Mongo documents remain valid.

Keep demo realism deterministic and local:

- Synthetic sensors are placed near the London demo center with hash-derived
  offsets.
- Synthetic APs use a curated SSID pool containing ISP defaults, public WiFi,
  mobile hotspots, corporate names, IoT/peripheral names, exactly one
  `FREE-WIFI`, one near-miss `BTWiFi-x`, and a small hidden-SSID sample.
- Synthetic clients encode demo vendor profiles in the locally administered
  `02:00:` MAC range and receive plausible probe histories from the same SSID
  pool.

The near-miss evil-twin-looking SSID is included only as labelled demo fixture
data. It gives future local classifiers and map views something suspicious to
surface without creating any active attack behavior.

## Consequences

Existing sensor documents load with `None` coordinates until updated. Existing
demo data can be refreshed with `make unseed-demo && make seed-demo`; no
database migration is required.

The AP `ssid` field is now nullable so hidden APs are represented explicitly
instead of overloading the empty string.

## Alternatives Considered

- Keep synthetic names like `synth-ap-00`: simpler, but it fails the goal of
  making the local demo immediately legible.
- Randomize SSIDs per seed run: more varied, but unstable fixtures make tests
  and screenshots harder to compare.
- Use real vendor OUIs in synthetic MACs: rejected because demo MACs must remain
  visually fake and grep-able with the `02:00:` prefix.
