import { describe, expect, it } from "vitest";
import { multiplyMoney, sumMoney } from "../src/lib/money.js";

describe("money arithmetic", () => {
  it("avoids floating point multiplication errors", () => {
    expect(multiplyMoney("3", "0.10")).toBe("0.30");
    expect(multiplyMoney("2.5", "10.00")).toBe("25.00");
  });

  it("rounds products to cents using half-up rounding", () => {
    expect(multiplyMoney("1.2345", "1.01")).toBe("1.25");
  });

  it("sums decimal amounts without floating point drift", () => {
    expect(sumMoney(["0.10", "0.20", "0.30"])).toBe("0.60");
  });
});
