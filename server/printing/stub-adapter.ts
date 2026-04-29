import type { LabelPrintAdapter, PrintInput, PrintResult } from "./adapter";

export class StubAdapter implements LabelPrintAdapter {
  readonly name = "STUB" as const;
  async print(input: PrintInput): Promise<PrintResult> {
    return { status: "SUCCESS", qtyPrinted: input.qty, diagnostics: { stubbed: true } };
  }
}
