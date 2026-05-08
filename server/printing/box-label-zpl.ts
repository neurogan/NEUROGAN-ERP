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
    // Large QR code centered (mag 10 ≈ 330 dots wide for typical box label data)
    `^FO342,100^BQN,2,10^FDMM,A${box.boxLabel}^FS`,
    // Text fields
    `^FO40,460^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,505^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,550^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,595^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
  ];

  let nextY = 640;
  if (box.expiryDate) {
    lines.push(`^FO40,${nextY}^A0N,36,36^FDExpiry: ${box.expiryDate}^FS`);
    nextY += 45;
  }

  lines.push(`^FO40,${nextY}^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`);
  lines.push(`^FO40,${nextY + 80}^BY2,2,70^BCN,,Y,N,N^FD${box.boxLabel}^FS`);
  lines.push("^XZ");

  return lines.join("\n");
}
