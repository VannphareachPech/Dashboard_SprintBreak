import { describe, it, expect } from "vitest";
import {
  classifyDelta,
  classifyPriorityBand,
  tokenizeForClustering,
  jaccardSimilarity,
  clusterSimilarComments,
  sanitizeMentionCount,
} from "./insights";

describe("classifyDelta", () => {
  it("returns 'unknown' when the value is not a finite number", () => {
    expect(classifyDelta("nope")).toBe("unknown");
    expect(classifyDelta(NaN)).toBe("unknown");
    expect(classifyDelta(undefined)).toBe("unknown");
  });

  it("flags clear drops and rises", () => {
    expect(classifyDelta(-0.2)).toBe("declining");
    expect(classifyDelta(-1)).toBe("declining");
    expect(classifyDelta(0.2)).toBe("improving");
    expect(classifyDelta(1)).toBe("improving");
  });

  it("treats near-zero movement as stable", () => {
    expect(classifyDelta(0)).toBe("stable");
    expect(classifyDelta(0.05)).toBe("stable");
    expect(classifyDelta(-0.05)).toBe("stable");
  });

  it("labels small movements as softening or rising", () => {
    expect(classifyDelta(-0.15)).toBe("softening");
    expect(classifyDelta(0.15)).toBe("rising");
  });
});

describe("classifyPriorityBand", () => {
  it("marks low scores or repeated risk as critical", () => {
    expect(classifyPriorityBand(3.0, 0)).toBe("critical");
    expect(classifyPriorityBand(3.6, 2)).toBe("critical");
    expect(classifyPriorityBand(undefined, 3)).toBe("critical");
  });

  it("marks mid scores as watch", () => {
    expect(classifyPriorityBand(3.6, 0)).toBe("watch");
    expect(classifyPriorityBand(3.9, 1)).toBe("watch");
  });

  it("marks healthy scores as strong", () => {
    expect(classifyPriorityBand(4.2, 0)).toBe("strong");
    expect(classifyPriorityBand(undefined, 0)).toBe("strong");
  });
});

describe("tokenizeForClustering", () => {
  it("lowercases, drops punctuation and stopwords, and keeps meaningful words", () => {
    const tokens = tokenizeForClustering("The team needs better tools!");
    expect(tokens).toEqual(new Set(["team", "needs", "better", "tools"]));
  });

  it("ignores words of two characters or fewer", () => {
    expect(tokenizeForClustering("go to it")).toEqual(new Set());
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0 when either set is empty", () => {
    expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });

  it("returns the overlap ratio for partially matching sets", () => {
    expect(jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
  });
});

describe("clusterSimilarComments", () => {
  it("groups similar comments and keeps the longest as the representative", () => {
    const clusters = clusterSimilarComments([
      "Leadership should speed up decision making",
      "Decision making by leadership needs to be faster overall",
      "The office coffee machine is broken",
    ]);

    const decisionCluster = clusters.find((c) => c.count === 2);
    expect(decisionCluster).toBeDefined();
    expect(decisionCluster?.representative).toBe(
      "Decision making by leadership needs to be faster overall"
    );

    expect(clusters.some((c) => c.count === 1 && /coffee/.test(c.representative))).toBe(true);
  });

  it("keeps unrelated comments in separate clusters", () => {
    const clusters = clusterSimilarComments([
      "Better onboarding for new starters",
      "Reduce meeting overload",
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.count === 1)).toBe(true);
  });
});

describe("sanitizeMentionCount", () => {
  it("ignores counts below two", () => {
    expect(sanitizeMentionCount(1, 5)).toBeUndefined();
    expect(sanitizeMentionCount(0, 5)).toBeUndefined();
  });

  it("ignores non-numeric values", () => {
    expect(sanitizeMentionCount("many", 5)).toBeUndefined();
    expect(sanitizeMentionCount(undefined, 5)).toBeUndefined();
  });

  it("clamps to the highest observed count", () => {
    expect(sanitizeMentionCount(10, 8)).toBe(8);
    expect(sanitizeMentionCount(5, 8)).toBe(5);
  });

  it("rounds and falls back to its own value when nothing was observed", () => {
    expect(sanitizeMentionCount(2.6, 0)).toBe(3);
  });
});
