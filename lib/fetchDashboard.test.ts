import { describe, it, expect } from "vitest";
import {
  scoreToOverallStatus,
  normalizeTrendList,
  hasUsablePulseHistory,
} from "./fetchDashboard";

describe("scoreToOverallStatus", () => {
  it("maps score ranges to their status label", () => {
    expect(scoreToOverallStatus(4.5)).toBe("Strong");
    expect(scoreToOverallStatus(4.0)).toBe("Strong");
    expect(scoreToOverallStatus(3.7)).toBe("Stable");
    expect(scoreToOverallStatus(3.5)).toBe("Stable");
    expect(scoreToOverallStatus(3.2)).toBe("Watch");
    expect(scoreToOverallStatus(3.0)).toBe("Watch");
    expect(scoreToOverallStatus(2.9)).toBe("At Risk");
  });
});

describe("normalizeTrendList", () => {
  it("returns an empty list for non-array input", () => {
    expect(normalizeTrendList(null)).toEqual([]);
    expect(normalizeTrendList(undefined)).toEqual([]);
    expect(normalizeTrendList("nope")).toEqual([]);
  });

  it("coerces score strings to numbers", () => {
    const result = normalizeTrendList([{ cycle: "Jan '26", overallScore: "3.2" }]);
    expect(result).toEqual([{ cycle: "Jan '26", overallScore: 3.2 }]);
  });

  it("drops entries with an empty cycle or a non-positive score", () => {
    const result = normalizeTrendList([
      { cycle: "Jan '26", overallScore: 3.5 },
      { cycle: "", overallScore: 4 },
      { cycle: "Feb '26", overallScore: 0 },
    ]);
    expect(result).toEqual([{ cycle: "Jan '26", overallScore: 3.5 }]);
  });
});

describe("hasUsablePulseHistory", () => {
  it("requires at least two points", () => {
    expect(hasUsablePulseHistory([{ cycle: "Jan '26", overallScore: 3.5 }])).toBe(false);
    expect(hasUsablePulseHistory([])).toBe(false);
  });

  it("is true when every cycle is a real label", () => {
    expect(
      hasUsablePulseHistory([
        { cycle: "Jan '26", overallScore: 3.5 },
        { cycle: "Feb '26", overallScore: 3.7 },
      ])
    ).toBe(true);
  });

  it("is false when any cycle is unknown", () => {
    expect(
      hasUsablePulseHistory([
        { cycle: "Jan '26", overallScore: 3.5 },
        { cycle: "Unknown", overallScore: 3.7 },
      ])
    ).toBe(false);
  });
});
