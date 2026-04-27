import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const setupPagePath = resolve(__dirname, "../app/setup/page.tsx");
const setupViewsPath = resolve(__dirname, "../components/live-setup-views.tsx");

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("setup first screen keeps repo, GitHub, runtime, and live bridge behind clear support sections", () => {
  const pageSource = source(setupPagePath);

  assert.match(pageSource, /title="接通后就回到同一条工作对话"/);
  assert.match(pageSource, /description="跟着下一步接通模板、仓库、GitHub 和运行环境；接好后直接回聊天继续工作。"/);
  assert.match(pageSource, /contextTitle="现在还差哪一步"/);
  assert.match(pageSource, /contextDescription="首屏只看当前缺口，其他支持信息按需展开。"/);
  assert.match(pageSource, /<OnboardingExperience \/>/);
  assert.match(pageSource, /!buildFirstStartJourney\(state\.workspace, state\.auth\.session\)\.onboardingDone/);
  assert.match(pageSource, /<SetupFirstStartJourneyPanel \/>/);
  assert.match(pageSource, /data-testid="setup-overview-details"/);
  assert.match(pageSource, /data-testid="setup-overview-toggle"/);
  assert.match(pageSource, /展开当前状态概览/);
  assert.match(pageSource, /<LiveSetupOverview \/>/);
  assert.match(pageSource, /<RepoBindingConsole \/>/);
  assert.match(pageSource, /<GitHubConnectionConsole \/>/);
  assert.match(pageSource, /<LiveBridgeConsole \/>/);
  assert.match(pageSource, /<OnboardingStudioPanel \/>/);
  assert.match(pageSource, /id="setup-repo-section"/);
  assert.match(pageSource, /id="setup-runtime-section"/);
  assert.match(pageSource, /id="setup-template-section"/);
  assert.match(pageSource, /data-testid="setup-diagnostics-section"/);
  assert.match(pageSource, /展开仓库与远端/);
  assert.match(pageSource, /展开运行环境/);
  assert.match(pageSource, /展开模板和启动包/);
  assert.match(pageSource, /<details/);

  const repoIndex = pageSource.indexOf("<RepoBindingConsole />");
  const setupPrimaryIndex = pageSource.indexOf("<SetupFirstStartJourneyPanel />");
  const overviewIndex = pageSource.indexOf("data-testid=\"setup-overview-details\"");
  const githubIndex = pageSource.indexOf("<GitHubConnectionConsole />");
  const bridgeIndex = pageSource.indexOf("<LiveBridgeConsole />");
  const onboardingIndex = pageSource.indexOf("<OnboardingStudioPanel />");
  assert.notEqual(setupPrimaryIndex, -1);
  assert.notEqual(overviewIndex, -1);
  assert.notEqual(repoIndex, -1);
  assert.notEqual(githubIndex, -1);
  assert.notEqual(bridgeIndex, -1);
  assert.notEqual(onboardingIndex, -1);
  assert.ok(setupPrimaryIndex < overviewIndex, "setup primary action should appear before overview details");
  assert.ok(repoIndex < onboardingIndex, "repo binding should stay reachable before onboarding studio");
  assert.ok(githubIndex < onboardingIndex, "GitHub connection should stay reachable before onboarding studio");
  assert.ok(bridgeIndex < onboardingIndex, "live bridge should stay reachable before onboarding studio");
});

test("setup overview tells users to finish four explicit setup checkpoints before diagnostics", () => {
  const viewsSource = source(setupViewsPath);
  const refreshActionMentions = viewsSource.match(/setup-onboarding-refresh-progress/g) ?? [];
  const finishActionMentions = viewsSource.match(/setup-onboarding-finish/g) ?? [];

  assert.match(viewsSource, /const setupPrimaryAction = buildSetupPrimaryAction/);
  assert.match(viewsSource, /const shouldCollapseTemplateManager = progress\.templateConfirmed \|\| workspace\.onboarding\.status === "done"/);
  assert.match(viewsSource, /function renderStudioActionButtons\(includeTestIds: boolean\)/);
  assert.match(viewsSource, /data-testid="setup-first-start-steps-details"/);
  assert.match(viewsSource, /data-testid="setup-first-start-steps-toggle"/);
  assert.match(viewsSource, /data-testid="setup-onboarding-manage-details"/);
  assert.match(viewsSource, /展开模板、分工和协作细节/);
  assert.match(viewsSource, /默认继续当前工作/);
  assert.match(viewsSource, /上面的摘要卡负责继续和完成；这里展开后只看模板会写入什么。/);
  assert.match(viewsSource, /继续和完成按钮保留在上面的当前启动包卡，这里只看进度。/);
  assert.match(viewsSource, /需要时再展开三步说明，先按上面的下一步继续。/);
  assert.match(viewsSource, /href=\{setupPrimaryAction\.href\}/);
  assert.match(viewsSource, /首屏只看四项/);
  assert.match(viewsSource, /title: "仓库"/);
  assert.match(viewsSource, /title: "GitHub"/);
  assert.match(viewsSource, /title: "运行环境"/);
  assert.match(viewsSource, /现在先补/);
  assert.match(viewsSource, /完成后进入/);
  assert.match(viewsSource, /调度、配额、租约和运行环境明细都收在下面的高级信息/);
  assert.equal(refreshActionMentions.length, 1);
  assert.equal(finishActionMentions.length, 1);
});
