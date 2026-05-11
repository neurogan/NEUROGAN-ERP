// Zebra Browser Print SDK — loaded via <script> tag in index.html
declare const BrowserPrint: {
  getLocalDevices: (
    success: (devices: ZebraDevice[]) => void,
    error: (e: string) => void,
    type?: string,
  ) => void;
};

export interface ZebraDevice {
  name: string;
  send: (data: string, success?: () => void, error?: (e: string) => void) => void;
}

export interface BoxLabelData {
  boxLabel: string;          // e.g. "RCV-20260505-001-BOX-01"
  boxNumber: number;         // 1-based
  boxCount: number;          // total boxes in this lot
  componentName: string;
  supplierLotNumber: string;
  supplierName: string;
  poNumber: string;
  dateReceived: string;      // "YYYY-MM-DD"
  receivingUniqueId: string; // e.g. "RCV-20260505-001"
  expiryDate?: string;
}

// ZPL template for Zebra ZT2411 at 203 dpi, 5x7 inch label (1015x1421 dots)
// Must stay in sync with server/printing/box-label-zpl.ts::buildBoxLabelZpl
export function buildZpl(box: BoxLabelData): string {
  const lines = [
    "^XA",
    "^PW1015",
    "^LL1421",
    `^FO40,30^A0N,55,55^FD${box.componentName}^FS`,
    // Large QR code centered (mag 10 ≈ 330 dots wide for typical box label data)
    `^FO342,100^BQN,2,10^FDMM,A${box.boxLabel}^FS`,
    `^FO40,500^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,545^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,590^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,635^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
  ];

  let nextY = 680;
  if (box.expiryDate) {
    lines.push(`^FO40,${nextY}^A0N,36,36^FDExpiry: ${box.expiryDate}^FS`);
    nextY += 45;
  }

  lines.push(`^FO40,${nextY}^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`);
  lines.push(`^FO40,${nextY + 80}^BY2,2,70^BCN,,Y,N,N^FD${box.boxLabel}^FS`);
  lines.push("^XZ");

  return lines.join("\n");
}

export function getZebraPrinter(): Promise<ZebraDevice | null> {
  return new Promise((resolve) => {
    if (typeof BrowserPrint === "undefined") {
      resolve(null);
      return;
    }
    BrowserPrint.getLocalDevices(
      (devices) => resolve(devices[0] ?? null),
      () => resolve(null),
      "printer",
    );
  });
}

export async function printLabels(
  device: ZebraDevice,
  boxes: BoxLabelData[],
  onProgress: (printed: number) => void,
): Promise<void> {
  for (let i = 0; i < boxes.length; i++) {
    await new Promise<void>((resolve, reject) => {
      device.send(buildZpl(boxes[i]!), resolve, (e) => reject(new Error(e)));
    });
    onProgress(i + 1);
  }
}
