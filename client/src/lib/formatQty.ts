/**
 * Smart number formatter with comma separators and adaptive decimals.
 *
 * Magnitude-based decimal rules:
 *   >= 1000  → 0 decimals (unless meaningful fractional part)
 *   >= 1     → max 2 decimals
 *   >= 0.01  → max 4 decimals
 *   < 0.01   → max 6 decimals
 *
 * Trailing zeros are always trimmed.
 */
export function formatQty(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return "0";

  const abs = Math.abs(num);
  const maxDecimals = abs >= 1000 ? 6 : abs >= 0.1 ? 2 : abs >= 0.01 ? 4 : 6;

  // Format with the chosen precision, then strip trailing zeros
  let fixed = num.toFixed(maxDecimals);
  if (fixed.includes(".")) {
    fixed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  }

  // Add thousand separators to the integer part
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return decPart ? `${withCommas}.${decPart}` : withCommas;
}
