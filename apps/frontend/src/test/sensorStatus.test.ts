import { describe, expect, it } from "vitest";
import { sensorStatus } from "@/lib/sensorStatus";

const iso = (offsetMs: number): string => new Date(Date.now() - offsetMs).toISOString();

describe("sensorStatus", () => {
  it("returns 'offline' for a revoked sensor regardless of last_seen", () => {
    expect(sensorStatus({ revoked: true, last_seen: iso(1_000) })).toBe("offline");
  });

  it("returns 'offline' when last_seen is null / undefined", () => {
    expect(sensorStatus({ revoked: false, last_seen: null })).toBe("offline");
    expect(sensorStatus({ revoked: false, last_seen: undefined })).toBe("offline");
  });

  it("returns 'live' when last_seen is within the 30s window", () => {
    expect(sensorStatus({ revoked: false, last_seen: iso(5_000) })).toBe("live");
    expect(sensorStatus({ revoked: false, last_seen: iso(29_000) })).toBe("live");
  });

  it("returns 'stale' between 30s and 5m", () => {
    expect(sensorStatus({ revoked: false, last_seen: iso(60_000) })).toBe("stale");
    expect(sensorStatus({ revoked: false, last_seen: iso(4 * 60_000) })).toBe("stale");
  });

  it("returns 'offline' once age exceeds 5m", () => {
    expect(sensorStatus({ revoked: false, last_seen: iso(6 * 60_000) })).toBe("offline");
    expect(sensorStatus({ revoked: false, last_seen: iso(24 * 60 * 60_000) })).toBe("offline");
  });
});
