import { StubAdapter } from "../stub-adapter";

test("StubAdapter returns SUCCESS with provided qty", async () => {
  const adapter = new StubAdapter();
  const result = await adapter.print({
    artwork: { id: "a", productId: "p", version: "v1", variableDataSpec: { lot: true, expiry: true } } as any,
    lot: "L001",
    expiry: new Date("2027-01-01"),
    qty: 100,
  });
  expect(result.status).toBe("SUCCESS");
  expect(result.qtyPrinted).toBe(100);
  expect(result.diagnostics.stubbed).toBe(true);
});
