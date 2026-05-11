export interface BoxLabelData {
  boxLabel: string;
  boxNumber: number;
  boxCount: number;
  componentName: string;
  supplierLotNumber: string;
  supplierName: string;
  poNumber: string;
  dateReceived: string;
  receivingUniqueId: string;
  expiryDate?: string;
}

// ZPL template — must stay in sync with client/src/lib/zebra-print.ts::buildZpl
// Zebra ZT2411, 203 dpi, 5x7 inch label (1015x1421 dots)
export function buildBoxLabelZpl(box: BoxLabelData): string {
  const lines = [
    "^XA",
    "^PW1015",
    "^LL1421",
    // Component name
    `^FO40,30^A0N,55,55^FD${box.componentName}^FS`,
    // Large QR code centered (mag 12 ≈ 444 dots wide; center X = (1015-444)/2 = 285)
    `^FO285,100^BQN,2,12^FDMM,A${box.boxLabel}^FS`,
    // Text fields start below QR (mag 12 bottom ≈ y=544)
    `^FO40,570^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,615^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,660^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,705^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
  ];

  let nextY = 750;
  if (box.expiryDate) {
    lines.push(`^FO40,${nextY}^A0N,36,36^FDExpiry: ${box.expiryDate}^FS`);
    nextY += 45;
  }

  lines.push(`^FO40,${nextY}^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`);
  // Barcode pinned to bottom of label
  lines.push(`^FO40,1200^BY2,2,70^BCN,,Y,N,N^FD${box.boxLabel}^FS`);
  lines.push("^XZ");

  return lines.join("\n");
}
