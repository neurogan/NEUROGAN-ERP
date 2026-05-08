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
}

// ZPL template — must stay in sync with client/src/lib/zebra-print.ts::buildZpl
export function buildBoxLabelZpl(box: BoxLabelData): string {
  return [
    "^XA",
    "^PW1015",
    "^LL1421",
    `^FO640,40^BQN,2,5^FDMM,A${box.boxLabel}^FS`,
    `^FO40,40^A0N,60,60^FD${box.componentName}^FS`,
    `^FO40,120^A0N,36,36^FDLot: ${box.receivingUniqueId}^FS`,
    `^FO40,165^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,210^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,255^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,300^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
    `^FO40,380^BY3,2,120^BCN,,Y,N,N^FD${box.boxLabel}^FS`,
    `^FO40,540^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`,
    "^XZ",
  ].join("\n");
}
