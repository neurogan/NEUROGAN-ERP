import * as net from "node:net";
import type { LabelPrintAdapter, PrintInput, PrintResult } from "./adapter";

const CONNECT_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 10_000;

export class ZplOverTcpAdapter implements LabelPrintAdapter {
  readonly name = "ZPL_TCP" as const;
  constructor(private host: string, private port: number) {}

  async print(input: PrintInput): Promise<PrintResult> {
    const zpl = renderZpl(input);
    return this.sendZpl(zpl, input.qty);
  }

  async printRaw(zpl: string): Promise<PrintResult> {
    return this.sendZpl(zpl, 1);
  }

  private sendZpl(zpl: string, qty: number): Promise<PrintResult> {
    const start = Date.now();
    const { host, port } = this;
    return new Promise<PrintResult>((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const total = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve({
          status: "FAILED",
          qtyPrinted: 0,
          diagnostics: {
            error: "total timeout",
            host,
            port,
            durationMs: Date.now() - start,
          },
        });
      }, TOTAL_TIMEOUT_MS);
      sock.setTimeout(CONNECT_TIMEOUT_MS);
      sock.on("timeout", () => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        sock.destroy();
        resolve({
          status: "FAILED",
          qtyPrinted: 0,
          diagnostics: { error: "connect timeout", host, port },
        });
      });
      sock.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        resolve({
          status: "FAILED",
          qtyPrinted: 0,
          diagnostics: { error: err.message, host, port },
        });
      });
      sock.connect(port, host, () => {
        sock.write(zpl, () => sock.end());
      });
      sock.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        resolve({
          status: "SUCCESS",
          qtyPrinted: qty,
          diagnostics: {
            host,
            port,
            durationMs: Date.now() - start,
            bytesSent: zpl.length,
          },
        });
      });
    });
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
