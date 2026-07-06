// Types matching the Apps Script JSON response. The frontend renders these as-is.

export interface AreaScore {
  area: string;
  score: number;
  delta?: number;           // change vs previous pulse (computed by Apps Script)
  pulsesAtRisk?: number;    // consecutive pulses at Watch or worse
}

export interface TrendPoint {
  cycle: string;       // e.g. "Jan '26"
  overallScore: number;
  // per-area scores keyed by area name — present when Trend sheet has area columns
  [areaName: string]: string | number;
}

export interface RecommendationTheme {
  theme: string;
  frequency: number;
  suggestedAction: string;
  pulsesActive?: number;    // how many pulse runs this theme has appeared in
  areaLink?: string;        // survey area this signal is linked to (matches AreaScore.area)
}

export type ActionStatus = "Planned" | "In Progress" | "Completed";

export interface ActionItem {
  suggestedAction: string;
  owner: string;
  status: ActionStatus;
  pulseOpened?: string;     // pulse label when this commitment was created, e.g. "Apr '26"
  area?: string;            // linked survey area for outcome correlation
  notes?: string;           // optional free-text notes
  isPinned?: boolean;       // leadership pin flag for high-priority items
  id?: string;              // stable UUID assigned by Apps Script on creation; used for update/delete matching
}

export interface SummaryData {
  totalResponses: number;
  teamSize?: number;              // total team headcount for participation rate
  highestArea: string;
  lowestArea: string;
  overallStatus: string;         // e.g. "Stable", "At Risk", "Strong"
  overallScore: number;
  scoreDelta?: number;            // change vs previous cycle (computed by Apps Script)
  lowestAreaScore?: number;      // current score for lowestArea (computed by Apps Script)
  lowestAreaPulsesAtRisk?: number; // consecutive pulses below stable for lowestArea
}

export type ResponseRawData = {
  [areaName: string]: number | string; // Area name -> score (1-5), "Pulse Cycle" -> label
};

// Root shape returned by the Apps Script doGet() endpoint
export interface DashboardData {
  cycle: string;              // e.g. "Jun '26"
  generatedDate: string;      // ISO date string, e.g. "2026-06-08"
  narrativeSummary?: string;  // plain-English executive summary
  summary: SummaryData;
  areaScores: AreaScore[];
  trends: TrendPoint[];
  prevCycle?: string;         // cycle label for the pulse before current (computed by Apps Script)
  focusSuggestion?: string;   // suggested action for lowest-scoring area (computed by Apps Script)
  recommendations: RecommendationTheme[];
  actions: ActionItem[];
  responseCurrentRawData?: ResponseRawData[]; // raw responses for current pulse cycle
  responseAllRawData?: ResponseRawData[];     // raw responses for all pulse cycles
  roleSplit?: RoleSplitRow[];          // per-area scores by role group
  responseCounts?: ResponseCountPoint[]; // response participation per pulse
  responseMix?: ResponseMixRow[];      // per-area positive/mixed/negative share
  comments?: string[];                  // open-text recommendations from column K (current cycle, filtered)
}

// Role Split
// One row per survey area, with a score per role group and computed gap.
export interface RoleSplitRow {
  area: string;
  scores: Record<string, number>;  // key = role group name, value = avg score
  roleGap: number;                 // max score minus min score across groups
}

// Response Counts
export interface ResponseCountPoint {
  cycle: string;          // pulse label e.g. "Jun '26"
  responseCount: number;
}

// Current Pulse Response Mix
export interface ResponseMixRow {
  area: string;
  positive: number; // percent (0..100)
  mixed: number;    // percent (0..100)
  negative: number; // percent (0..100)
  total: number;    // response count used for this area
}
