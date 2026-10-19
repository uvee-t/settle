import { describe, expect, it } from "vitest";
import { multiplyMoney, sumMoney } from "../src/lib/money.js";

describe("money arithmetic", () => {
  describe("multiplyMoney", () => {
    it("avoids floating point multiplication errors", () => {
      expect(multiplyMoney("3", "0.10")).toBe("0.30");
      expect(multiplyMoney("2.5", "10.00")).toBe("25.00");
    });

    it("rounds products to cents using half-up rounding", () => {
      expect(multiplyMoney("1.2345", "1.01")).toBe("1.25");
      expect(multiplyMoney("1.0050", "1.00")).toBe("1.01");
    });

    it("preserves trailing zeroes in the result", () => {
      expect(multiplyMoney("1", "2")).toBe("2.00");
      expect(multiplyMoney("0.5", "0.10")).toBe("0.05");
    });

    it("rejects invalid decimal values", () => {
      expect(() => multiplyMoney("1.23456", "1.00")).toThrow(
        "Too many decimal places",
      );
      expect(() => multiplyMoney("abc", "1.00")).toThrow(
        "Invalid decimal value",
      );
    });
  });

  describe("sumMoney", () => {
    it("sums decimal amounts without floating point drift", () => {
      expect(sumMoney(["0.10", "0.20", "0.30"])).toBe("0.60");
    });

    it("handles whole numbers and empty input", () => {
      expect(sumMoney(["10", "2.50", "0.50"])).toBe("13.00");
      expect(sumMoney([])).toBe("0.00");
    });

    it("preserves two decimal places", () => {
      expect(sumMoney(["1", "2"])).toBe("3.00");
      expect(sumMoney(["1.2", "2.3"])).toBe("3.50");
    });

    it("rejects values with more than two decimal places", () => {
      expect(() => sumMoney(["1.001"])).toThrow("Invalid money value");
    });

    it("rejects malformed values", () => {
      expect(() => sumMoney(["abc"])).toThrow("Invalid money value");
      expect(() => sumMoney(["-1.00"])).toThrow("Invalid money value");
    });
  });
});
