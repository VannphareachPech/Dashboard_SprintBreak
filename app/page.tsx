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
  const title = "Live Data Is Unavailable";

  const message = error?.code === "MISSING_URL"
    ? "Set the Apps Script endpoint in your environment variables so the dashboard can load live pulse data."
    : error?.code === "HTTP_ERROR"
    ? "The Apps Script endpoint returned an error response."
    : error?.code === "NON_JSON_RESPONSE"
    ? "The endpoint did not return JSON. This usually means deployment access is restricted or the URL is incorrect."
    : error?.code === "INVALID_PAYLOAD"
    ? "The endpoint returned data, but required dashboard fields were missing."
    : "The dashboard could not reach the Apps Script endpoint.";

  const showEnvHint = error?.code === "MISSING_URL";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-[0_8px_30px_rgba(2,6,23,0.06)]">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-600 mb-1">The dashboard is temporarily showing no live survey data.</p>
        <p className="text-slate-500 text-sm mb-4">Most issues are endpoint URL, access settings, or environment config.</p>

        <p className="text-slate-600 mb-4">{message}</p>

        {error?.details && (
          <p className="mb-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            Details: {error.details}
          </p>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-5">
          <p className="text-sm font-semibold text-slate-800 mb-2">Quick Checklist</p>
          <ul className="space-y-1.5 text-sm text-slate-600 list-disc pl-5">
            <li>Confirm APPS_SCRIPT_URL is set in your environment.</li>
            <li>Verify the Apps Script web app URL points to the latest endpoint.</li>
            <li>Check deployment access is set to Anyone with the link (or org-wide as intended).</li>
            <li>Test the URL directly and confirm it returns JSON, not a login page.</li>
          </ul>
        </div>

        {showEnvHint && (
          <div className="text-sm text-slate-500 font-mono bg-slate-100 p-3 rounded mb-5 inline-block">
            Set APPS_SCRIPT_URL in .env.local
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Retry Loading
          </Link>
          <a
            href="https://developers.google.com/apps-script/guides/web"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Apps Script Web App Guide
          </a>
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