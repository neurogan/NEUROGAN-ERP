export interface Z14Plan {
  codeLetterLevel2: string;
  sampleSize: number;
  acceptNumber: number;
  rejectNumber: number;
}

interface LotSizeEntry { maxSize: number; code: string }
interface CodeEntry { code: string; n: number; ac: number; re: number }

const LOT_SIZE_TABLE: LotSizeEntry[] = [
  { maxSize: 8,        code: "A" },
  { maxSize: 15,       code: "B" },
  { maxSize: 25,       code: "C" },
  { maxSize: 50,       code: "D" },
  { maxSize: 90,       code: "E" },
  { maxSize: 150,      code: "F" },
  { maxSize: 280,      code: "G" },
  { maxSize: 500,      code: "H" },
  { maxSize: 1200,     code: "J" },
  { maxSize: 3200,     code: "K" },
  { maxSize: 10000,    code: "L" },
  { maxSize: 35000,    code: "M" },
  { maxSize: 150000,   code: "N" },
  { maxSize: 500000,   code: "P" },
  { maxSize: Infinity, code: "Q" },
];

// AQL 2.5, Normal inspection. Codes A–C use D's plan (↑ arrow in standard).
const AQL_2_5: CodeEntry[] = [
  { code: "A", n: 8,    ac: 0,  re: 1  },
  { code: "B", n: 8,    ac: 0,  re: 1  },
  { code: "C", n: 8,    ac: 0,  re: 1  },
  { code: "D", n: 8,    ac: 0,  re: 1  },
  { code: "E", n: 13,   ac: 0,  re: 1  },
  { code: "F", n: 20,   ac: 1,  re: 2  },
  { code: "G", n: 32,   ac: 2,  re: 3  },
  { code: "H", n: 50,   ac: 3,  re: 4  },
  { code: "J", n: 80,   ac: 5,  re: 6  },
  { code: "K", n: 125,  ac: 7,  re: 8  },
  { code: "L", n: 200,  ac: 10, re: 11 },
  { code: "M", n: 315,  ac: 14, re: 15 },
  { code: "N", n: 500,  ac: 21, re: 22 },
  { code: "P", n: 800,  ac: 21, re: 22 },
  { code: "Q", n: 1250, ac: 21, re: 22 },
];

const AQL_TABLES: Record<string, CodeEntry[]> = { "2.5": AQL_2_5 };

export function computeZ14Plan(lotSize: number, aql: number | string = 2.5): Z14Plan {
  const aqlKey = String(Number(aql));
  const table = AQL_TABLES[aqlKey] ?? AQL_2_5;

  if (lotSize <= 1) {
    return { codeLetterLevel2: "A", sampleSize: 1, acceptNumber: 0, rejectNumber: 1 };
  }

  const codeEntry = LOT_SIZE_TABLE.find((e) => lotSize <= e.maxSize);
  const code = codeEntry?.code ?? "Q";

  const planEntry = table.find((e) => e.code === code) ?? table[table.length - 1]!;
  const sampleSize = Math.min(planEntry.n, lotSize);

  return {
    codeLetterLevel2: code,
    sampleSize,
    acceptNumber: planEntry.ac,
    rejectNumber: planEntry.re,
  };
}
