import { describe, it, expect } from "vitest";
import { versionInfo } from "./version";

describe("versionInfo (IQ traceability)", () => {
  it("exposes all the fields the IQ record expects", () => {
    expect(versionInfo).toHaveProperty("version");
    expect(versionInfo).toHaveProperty("commitSha");
    expect(versionInfo).toHaveProperty("commitShaShort");
    expect(versionInfo).toHaveProperty("environment");
    expect(versionInfo).toHaveProperty("nodeVersion");
    expect(versionInfo).toHaveProperty("startedAt");
  });

  it("reads the version from package.json", () => {
    // package.json currently has version '1.0.0' — this asserts the reader
    // isn't silently falling through to 'unknown'.
    expect(versionInfo.version).not.toBe("unknown");
    expect(versionInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("commitShaShort is 7 chars (or 'unknown' truncated)", () => {
    expect(versionInfo.commitShaShort).toHaveLength(7);
  });

  it("startedAt is a valid ISO timestamp", () => {
    expect(() => new Date(versionInfo.startedAt).toISOString()).not.toThrow();
  });

  it("is frozen (no mutation after boot)", () => {
    expect(Object.isFrozen(versionInfo)).toBe(true);
  });
});
