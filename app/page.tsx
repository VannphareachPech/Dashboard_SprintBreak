import { fetchDashboardData } from "@/lib/fetchDashboard";
import type { DashboardFetchError } from "@/lib/fetchDashboard";
import Link from "next/link";
import Header from "@/components/Header";
import HeroScore from "@/components/HeroScore";
import FocusArea from "@/components/FocusArea";
import ScoreChart from "@/components/ScoreChart";
import TrendChart from "@/components/TrendChart";
import ActionTracker from "@/components/ActionTracker";
import RoleSplitHeatmap from "@/components/RoleSplitHeatmap";
import ResponseCountChart from "@/components/ResponseCountChart";
import ResponseMixChart from "@/components/ResponseMixChart";
import SectionNav from "@/components/SectionNav";
import PulseQuestionTrendChart from "@/components/PulseQuestionTrendChart";
import GeminiInsights from "@/components/GeminiInsights";
import RefreshControl from "@/components/RefreshControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DashboardPageProps = {
  searchParams?: Promise<{
    fallbackPreview?: string;
  }>;
};

function Section({ title, subtitle, id, children }: { title: string; subtitle?: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="h-full min-w-0 flex flex-col space-y-2.5 scroll-mt-20">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-800">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function GroupDivider() {
  return <div className="mt-8 border-t border-slate-100" />;
}

function NoDataState({ error }: { error: DashboardFetchError | null }) {
  const title = "We Couldn't Load the Dashboard Right Now";
  const errorRef = error?.code
    ? `REF-${error.code}`
    : "REF-UNKNOWN";
  const friendlyErrorLabel = error?.code === "NON_JSON_RESPONSE"
    ? "Service Access Issue"
    : error?.code === "MISSING_URL"
    ? "Setup Configuration Needed"
    : error?.code === "HTTP_ERROR"
    ? "Service Temporarily Unavailable"
    : error?.code === "INVALID_PAYLOAD"
    ? "Data Format Issue"
    : error?.code === "NETWORK_ERROR"
    ? "Network Connection Issue"
    : "Unexpected Service Issue";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white px-6 py-7 sm:px-8 sm:py-9 shadow-[0_8px_30px_rgba(2,6,23,0.06)]">
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-700">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M6.5 17.5h10a3.5 3.5 0 0 0 .2-7A5 5 0 0 0 7 9.6a4 4 0 0 0-.5 7.9Z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m5 5 14 14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4">{title}</h1>

          <p className="text-slate-600 mb-6 leading-relaxed">
            We&apos;re having trouble connecting to our servers.
            <br />
            Please check your connection and try again.
          </p>

          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-indigo-600 px-8 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Retry
          </Link>

          <p className="mt-5 text-sm font-medium text-slate-600">{friendlyErrorLabel}</p>
          <p className="mt-1 text-xs text-slate-400">Error Code: {errorRef}</p>
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = searchParams ? await searchParams : undefined;

  if (params?.fallbackPreview === "1") {
    return (
      <NoDataState
        error={{
          code: "NON_JSON_RESPONSE",
          message: "Preview mode fallback state.",
          details: "Forced preview from query parameter.",
        }}
      />
    );
  }

  const { data, error } = await fetchDashboardData();

  if (!data) {
    return <NoDataState error={error} />;
  }

  const {
    cycle,
    generatedDate,
    narrativeSummary,
    summary,
    areaScores,
    trends,
    recommendations,
    actions,
    roleSplit,
    responseCounts,
    responseMix,
    comments,
    prevCycle,
    focusSuggestion,
  } = data;

  const currentCycleCount =
    responseCounts?.find((r) => r.cycle === cycle)?.responseCount ?? summary.totalResponses;

  const focusAreaEntry = areaScores.find((a) => a.area === summary.lowestArea);
  const focusScore = focusAreaEntry?.score ?? summary.lowestAreaScore ?? 0;
  const focusPulsesAtRisk = focusAreaEntry?.pulsesAtRisk ?? summary.lowestAreaPulsesAtRisk;

  const rankedAreas = [...areaScores].sort((a, b) => a.score - b.score);
  const focusRank = rankedAreas.findIndex((a) => a.area === summary.lowestArea) + 1;

  const gapFromOverall =
    focusScore > 0 && summary.overallScore > 0
      ? Math.round((focusScore - summary.overallScore) * 10) / 10
      : undefined;

  const previousFocusScore = (() => {
    if (!summary.lowestArea || trends.length < 2) return undefined;
    const prev = Number(trends[trends.length - 2][summary.lowestArea]);
    return Number.isNaN(prev) ? undefined : prev;
  })();

  return (
    <>
      <SectionNav />

      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
        <main>
          <section id="overview" className="space-y-4 scroll-mt-20">
            <Header
              cycle={cycle}
              generatedDate={generatedDate}
              totalResponses={currentCycleCount}
              teamSize={summary.teamSize}
              participationTextOverride={process.env.DEMO_PARTICIPATION_TEXT}
            >
              <RefreshControl />
            </Header>

            <section id="executive-summary" className="scroll-mt-20">
              <HeroScore summary={summary} prevCycle={prevCycle} narrativeSummary={narrativeSummary} />
            </section>

            {summary.lowestArea && (
              <section id="focus" className="scroll-mt-20">
                <FocusArea
                  area={summary.lowestArea}
                  score={focusScore}
                  pulsesAtRisk={focusPulsesAtRisk}
                  areaRank={focusRank > 0 ? focusRank : undefined}
                  totalAreas={areaScores.length || undefined}
                  gapFromOverall={gapFromOverall}
                  previousScore={previousFocusScore}
                  suggestedAction={focusSuggestion}
                />
              </section>
            )}

          </section>

          <GroupDivider />
          <div id="analytics" className="mt-5 space-y-5 scroll-mt-20">
            <div className="grid grid-cols-1 gap-5 items-stretch lg:grid-cols-2">
              <Section id="participation-trend" title="Participation Trends" subtitle="Response count per pulse cycle">
                <ResponseCountChart data={responseCounts ?? []} teamSize={summary?.teamSize} />
              </Section>

              <Section title="Overall Sentiment Trends" subtitle="Smoothed score trajectory across all pulses">
                <TrendChart trends={trends} />
              </Section>
            </div>

            <Section title="Focus Area Metrics" subtitle="Pulse-by-pulse question-level trend for your priority area">
              <PulseQuestionTrendChart trends={trends} />
            </Section>
          </div>

          <GroupDivider />
          <div id="diagnostics" className="mt-5 space-y-5 scroll-mt-20">
            <Section id="area-scores" title="Area Scores" subtitle="Current pulse scores across all focus areas — single snapshot">
              <ScoreChart areaScores={areaScores} />
            </Section>

            <Section id="response-mix" title="Sentiment" subtitle="Breakdown of response tone for the current pulse">
              <ResponseMixChart data={responseMix ?? []} />
            </Section>

            <Section id="role-split" title="Role Split" subtitle="Score variation by role or group across areas">
              <RoleSplitHeatmap rows={roleSplit ?? []} />
            </Section>
          </div>

          <GroupDivider />
          <div id="next-steps" className="mt-5 space-y-5 scroll-mt-20">
            <Section id="comments-themes" title="Comments & Themes">
              <GeminiInsights
                cycle={cycle}
                summary={summary}
                areaScores={areaScores}
                trends={trends}
                recommendations={recommendations}
                roleSplit={roleSplit}
                comments={comments}
              />
            </Section>

            <Section title="Action Items">
              <ActionTracker actions={actions} currentCycle={cycle} />
            </Section>
          </div>

          <footer className="mt-10 pt-5 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-1 text-xs text-slate-400">
              <span className="font-medium text-slate-500">Built by FAST and FIVE-IOUS with AI</span>
              <span>Data sourced from Google Sheets &middot; {cycle}</span>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}