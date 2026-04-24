import { describe, it, expect } from "vitest";
import { computeZ14Plan } from "./z14-sampling";

describe("computeZ14Plan", () => {
  it("lot size 1 → 100% inspection (sampleSize = 1)", () => {
    const p = computeZ14Plan(1);
    expect(p.sampleSize).toBe(1);
    expect(p.acceptNumber).toBe(0);
    expect(p.rejectNumber).toBe(1);
  });

  it("lot size 5 (code A) → uses D plan, sampleSize capped at 5", () => {
    const p = computeZ14Plan(5);
    expect(p.codeLetterLevel2).toBe("A");
    expect(p.sampleSize).toBe(5); // min(8, 5)
    expect(p.acceptNumber).toBe(0);
    expect(p.rejectNumber).toBe(1);
  });

  it("lot size 8 (code A boundary) → sampleSize = 8", () => {
    const p = computeZ14Plan(8);
    expect(p.codeLetterLevel2).toBe("A");
    expect(p.sampleSize).toBe(8);
  });

  it("lot size 50 (code D) → sampleSize = 8, Ac=0, Re=1", () => {
    const p = computeZ14Plan(50);
    expect(p.codeLetterLevel2).toBe("D");
    expect(p.sampleSize).toBe(8);
    expect(p.acceptNumber).toBe(0);
    expect(p.rejectNumber).toBe(1);
  });

  it("lot size 100 (code F) → sampleSize = 20, Ac=1, Re=2", () => {
    const p = computeZ14Plan(100);
    expect(p.codeLetterLevel2).toBe("F");
    expect(p.sampleSize).toBe(20);
    expect(p.acceptNumber).toBe(1);
    expect(p.rejectNumber).toBe(2);
  });

  it("lot size 500 (code H) → sampleSize = 50, Ac=3, Re=4", () => {
    const p = computeZ14Plan(500);
    expect(p.codeLetterLevel2).toBe("H");
    expect(p.sampleSize).toBe(50);
    expect(p.acceptNumber).toBe(3);
    expect(p.rejectNumber).toBe(4);
  });

  it("lot size 1000 (code J) → sampleSize = 80, Ac=5, Re=6", () => {
    const p = computeZ14Plan(1000);
    expect(p.codeLetterLevel2).toBe("J");
    expect(p.sampleSize).toBe(80);
    expect(p.acceptNumber).toBe(5);
    expect(p.rejectNumber).toBe(6);
  });

  it("lot size 1 000 000 (code Q) → sampleSize = 1250", () => {
    const p = computeZ14Plan(1_000_000);
    expect(p.codeLetterLevel2).toBe("Q");
    expect(p.sampleSize).toBe(1250);
    expect(p.acceptNumber).toBe(21);
    expect(p.rejectNumber).toBe(22);
  });

  it("sampleSize never exceeds lotSize", () => {
    for (const size of [3, 7, 10, 18, 30]) {
      const p = computeZ14Plan(size);
      expect(p.sampleSize).toBeLessThanOrEqual(size);
    }
  });
});
