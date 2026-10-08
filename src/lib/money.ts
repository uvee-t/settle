/** Money helpers using integer arithmetic to avoid IEEE-754 rounding surprises. */
function parseScaled(value: string, scale: bigint): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Invalid decimal value: ${value}`);
  const decimals = match[2] ?? "";
  const places = scale.toString().length - 1;
  if (decimals.length > places) throw new Error(`Too many decimal places: ${value}`);
  return BigInt(match[1]) * scale + BigInt((decimals + "0".repeat(places)).slice(0, places) || "0");
}

export function multiplyMoney(quantity: string, unitAmount: string): string {
  const q = parseScaled(quantity, 10_000n);
  const unit = parseScaled(unitAmount, 100n);
  const product = q * unit; // scale = 1e6
  const cents = (product + 5_000n) / 10_000n; // round half-up to cents
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function sumMoney(values: string[]): string {
  const cents = values.reduce((sum, value) => {
    const parsed = /^\d+(?:\.\d{1,2})?$/.test(value) ? parseScaled(value, 100n) : (() => { throw new Error(`Invalid money value: ${value}`); })();
    return sum + parsed;
  }, 0n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
