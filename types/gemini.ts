export interface GeminiInsightRow {
  roleGroupsMentioning: string;
  insight: string;
  recommendation: string;
  priority?: "High" | "Medium" | "Low";
  // Number of employee comments that were code-verified as raising this same
  // concern (via similarity clustering, not model guesswork). Omitted when the
  // insight is grounded in structured data (scores/role gaps) rather than a
  // repeated comment cluster.
  mentionCount?: number;
}

export interface GeminiInsightsResponse {
  rows: GeminiInsightRow[];
  summary: string;
  alreadyExists?: boolean;
  fromStorage?: boolean;
  unchangedData?: boolean;
  generatedAt?: string;
  generatedBy?: string;
}
