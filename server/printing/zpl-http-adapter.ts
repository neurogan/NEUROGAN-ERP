import type { LabelPrintAdapter, PrintInput, PrintResult } from "./adapter";

export class ZplOverHttpAdapter implements LabelPrintAdapter {
  readonly name = "ZPL_TCP" as const; // reuse name so existing settings work

  constructor(private printUrl: string) {}

  async print(input: PrintInput): Promise<PrintResult> {
    const zpl = renderZpl(input);
    return this.postZpl(zpl);
  }

  async printRaw(zpl: string): Promise<PrintResult> {
    return this.postZpl(zpl);
  }

  private async postZpl(zpl: string): Promise<PrintResult> {
    try {
      const res = await fetch(this.printUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: zpl,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 0) {
        return {
          status: "FAILED",
          qtyPrinted: 0,
          diagnostics: { error: `HTTP ${res.status}`, url: this.printUrl },
        };
      }
      return { status: "SUCCESS", qtyPrinted: 1, diagnostics: { url: this.printUrl } };
    } catch (err) {
      return {
        status: "FAILED",
        qtyPrinted: 0,
        diagnostics: { error: String(err), url: this.printUrl },
      };
    }
  }
}

function renderZpl(input: PrintInput): string {
  const lines = ["^XA"];
  let yOffset = 30;
  const spec = input.artwork.variableDataSpec as Record<string, unknown>;
  if (spec?.lot !== false) {
    lines.push(`^FO50,${yOffset}^A0N,30,30^FDLot: ${input.lot}^FS`);
    yOffset += 50;
  }
  if (spec?.expiry !== false) {
    const expiry = input.expiry.toISOString().split("T")[0];
    lines.push(`^FO50,${yOffset}^A0N,30,30^FDExp: ${expiry}^FS`);
  }
  lines.push(`^PQ${input.qty},0,1,Y`);
  lines.push("^XZ");
  return lines.join("\n");
}
