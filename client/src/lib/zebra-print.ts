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
}

// ZPL template for Zebra ZT2411 at 203 dpi, 5x7 inch label (1015x1421 dots)
export function buildZpl(box: BoxLabelData): string {
  return [
    "^XA",
    "^PW1015",
    "^LL1421",
    `^FO40,40^A0N,60,60^FD${box.componentName}^FS`,
    `^FO40,120^A0N,36,36^FDLot: ${box.receivingUniqueId}^FS`,
    `^FO40,165^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,210^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,255^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,300^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
    `^FO40,380^BY3,2,120^BCN,,Y,N,N^FD${box.boxLabel}^FS`,
    `^FO40,540^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`,
    "^FO40,610^FR^A0N,40,40^FDQUARANTINE - DO NOT USE^FS",
    "^XZ",
  ].join("\n");
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
