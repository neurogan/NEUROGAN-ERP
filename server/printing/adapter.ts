import type { LabelArtwork } from "@shared/schema";

export interface PrintInput {
  artwork: LabelArtwork;
  lot: string;
  expiry: Date;
  qty: number;
}

export interface PrintResult {
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  qtyPrinted: number;
  diagnostics: Record<string, unknown>;
}

export interface LabelPrintAdapter {
  readonly name: "ZPL_TCP" | "STUB";
  print(input: PrintInput): Promise<PrintResult>;
}
