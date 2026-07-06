// Pure helpers for turning pulse data and survey comments into insight signals.
// Kept framework-free so they are easy to unit test in isolation.

// Describes how an area's score changed versus the previous pulse.
export function classifyDelta(delta: unknown): string {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return "unknown";
  if (delta <= -0.2) return "declining";
  if (delta >= 0.2) return "improving";
  if (delta > -0.1 && delta < 0.1) return "stable";
  return delta < 0 ? "softening" : "rising";
}

// Buckets an area into a priority band from its score and consecutive at-risk pulses.
export function classifyPriorityBand(score: unknown, pulsesAtRisk: unknown): string {
  const safeScore = typeof score === "number" && Number.isFinite(score) ? score : null;
  const safeRisk = typeof pulsesAtRisk === "number" && Number.isFinite(pulsesAtRisk) ? pulsesAtRisk : 0;

  if ((safeScore != null && safeScore < 3.5) || safeRisk >= 2) return "critical";
  if (safeScore != null && safeScore < 4) return "watch";
  return "strong";
}

// Common words ignored when comparing comments so only meaningful terms count.
const CLUSTER_STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "with", "have", "this",
  "that", "our", "your", "from", "more", "some", "all", "can", "will", "would",
  "should", "could", "into", "than", "when", "what", "how", "also", "just",
  "get", "got", "very", "much", "many", "them", "they", "their", "there",
  "been", "being", "was", "were", "its", "it's", "a", "an", "to", "of", "in",
  "on", "is", "as", "at", "by", "we", "us", "i", "my",
]);

// Reduces a comment to its set of meaningful lowercase words.
export function tokenizeForClustering(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !CLUSTER_STOPWORDS.has(w))
  );
}

// Overlap ratio between two word sets (0 = nothing shared, 1 = identical).
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Comments are treated as the same concern when their word overlap hits this ratio.
const CLUSTER_SIMILARITY_THRESHOLD = 0.35;

export interface CommentCluster {
  representative: string;
  count: number;
}

// Groups near-duplicate comments so we can report how many people raised each concern.
export function clusterSimilarComments(comments: string[]): CommentCluster[] {
  const tokenSets = comments.map(tokenizeForClustering);
  const used = new Array(comments.length).fill(false);
  const clusters: CommentCluster[] = [];

  for (let i = 0; i < comments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const memberIndexes = [i];
    for (let j = i + 1; j < comments.length; j++) {
      if (used[j]) continue;
      if (jaccardSimilarity(tokenSets[i], tokenSets[j]) >= CLUSTER_SIMILARITY_THRESHOLD) {
        used[j] = true;
        memberIndexes.push(j);
      }
    }
    // Representative = longest comment in the cluster (most descriptive).
    const representative = memberIndexes
      .map((idx) => comments[idx])
      .sort((a, b) => b.length - a.length)[0];
    clusters.push({ representative, count: memberIndexes.length });
  }

  return clusters;
}

// Keeps a model-provided mention count only when it is a real repeat (>= 2) and
// never lets it exceed the highest count we actually observed in the comments.
export function sanitizeMentionCount(value: unknown, maxObserved: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 2) return undefined;
  return Math.min(Math.round(n), maxObserved || Math.round(n));
}
