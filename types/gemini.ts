export interface GeminiInsightRow {
  roleGroupsMentioning: string;
  insight: string;
  recommendation: string;
  priority?: "High" | "Medium" | "Low";
  // Number of comments raising this same concern (from similarity clustering).
  // Omitted when the insight comes from score data rather than repeated comments.
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
