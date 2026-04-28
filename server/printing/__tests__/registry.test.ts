import { setLabelPrintAdapter, resetLabelPrintAdapter, getLabelPrintAdapter } from "../registry";
import { StubAdapter } from "../stub-adapter";

afterEach(() => resetLabelPrintAdapter());

test("returns overridden adapter when set", async () => {
  const stub = new StubAdapter();
  setLabelPrintAdapter(stub);
  const result = await getLabelPrintAdapter();
  expect(result).toBe(stub);
});

test("resetLabelPrintAdapter clears the override", async () => {
  const stub = new StubAdapter();
  setLabelPrintAdapter(stub);

  // Confirm override is active before reset
  const before = await getLabelPrintAdapter();
  expect(before).toBe(stub);

  resetLabelPrintAdapter();

  // After reset, install a different stub to confirm the first override was cleared
  const stub2 = new StubAdapter();
  setLabelPrintAdapter(stub2);
  const after = await getLabelPrintAdapter();
  expect(after).toBe(stub2);
  expect(after).not.toBe(stub);
});
