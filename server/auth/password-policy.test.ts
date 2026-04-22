import { describe, it, expect } from "vitest";
import { validatePasswordComplexity, isPasswordExpired } from "./password-policy";

describe("validatePasswordComplexity", () => {
  it("accepts a strong password", () => {
    expect(validatePasswordComplexity("Str0ng!Pass#word").valid).toBe(true);
  });

  it("rejects passwords shorter than 8 chars", () => {
    const result = validatePasswordComplexity("Sh0rt!");
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === "TOO_SHORT")).toBe(true);
  });

  it("rejects passwords with no uppercase", () => {
    const result = validatePasswordComplexity("no_uppercase1!");
    expect(result.violations.some((v) => v.code === "NO_UPPERCASE")).toBe(true);
  });

  it("rejects passwords with no lowercase", () => {
    const result = validatePasswordComplexity("NO_LOWERCASE1!");
    expect(result.violations.some((v) => v.code === "NO_LOWERCASE")).toBe(true);
  });

  it("rejects passwords with no digit", () => {
    const result = validatePasswordComplexity("NoDigitsHere!!");
    expect(result.violations.some((v) => v.code === "NO_DIGIT")).toBe(true);
  });

  it("rejects passwords with no symbol", () => {
    const result = validatePasswordComplexity("NoSymbolsHere1");
    expect(result.violations.some((v) => v.code === "NO_SYMBOL")).toBe(true);
  });

  it("collects all violations when multiple rules fail", () => {
    const result = validatePasswordComplexity("short");
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts exactly 8 chars meeting all rules", () => {
    expect(validatePasswordComplexity("Abcd1!gh").valid).toBe(true);
  });
});

describe("isPasswordExpired", () => {
  it("returns false for a password changed today", () => {
    expect(isPasswordExpired(new Date())).toBe(false);
  });

  it("returns false for a password changed 89 days ago", () => {
    const d = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    expect(isPasswordExpired(d)).toBe(false);
  });

  it("returns true for a password changed 91 days ago", () => {
    const d = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    expect(isPasswordExpired(d)).toBe(true);
  });

  it("returns true for epoch (new account with temp password)", () => {
    expect(isPasswordExpired(new Date(0))).toBe(true);
  });
});
