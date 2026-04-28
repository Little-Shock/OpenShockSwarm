import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsSourcePath = resolve(__dirname, "../components/live-settings-views.tsx");
const settingsPagePath = resolve(__dirname, "../app/settings/page.tsx");
const settingsAdvancedPagePath = resolve(__dirname, "../app/settings/advanced/page.tsx");
const configRecoveryScriptPath = resolve(__dirname, "../../../../scripts/headed-config-persistence-recovery.mjs");

function settingsSource() {
  return readFileSync(settingsSourcePath, "utf8");
}

function settingsPageSource() {
  return readFileSync(settingsPagePath, "utf8");
}

function settingsAdvancedPageSource() {
  return readFileSync(settingsAdvancedPagePath, "utf8");
}

function configRecoveryScript() {
  return readFileSync(configRecoveryScriptPath, "utf8");
}

function sectionBetween(source: string, startPattern: string, endPattern: string) {
  const start = source.indexOf(startPattern);
  assert.notEqual(start, -1, `section start ${startPattern} should exist`);
  const end = source.indexOf(endPattern, start);
  assert.notEqual(end, -1, `section end ${endPattern} should exist`);
  return source.slice(start, end);
}

function disclosureSection(source: string, testId: string) {
  const testIdIndex = source.indexOf(`testId="${testId}"`);
  assert.notEqual(testIdIndex, -1, `settings disclosure ${testId} should exist`);
  const sectionStart = source.lastIndexOf("<SettingsDisclosureSection", testIdIndex);
  assert.notEqual(sectionStart, -1, `settings disclosure ${testId} should be a SettingsDisclosureSection`);
  const sectionEnd = source.indexOf("</SettingsDisclosureSection>", testIdIndex);
  assert.notEqual(sectionEnd, -1, `settings disclosure ${testId} should close`);
  return source.slice(sectionStart, sectionEnd);
}

test("settings first screen keeps workspace editing behind a disclosure", () => {
  const section = disclosureSection(settingsSource(), "workspace");

  assert.match(section, /title="启动与安全"/);
  assert.match(section, /<WorkspaceDurableConfigPanel \/>/);
});

test("settings first screen keeps member preferences behind a disclosure", () => {
  const section = disclosureSection(settingsSource(), "member");

  assert.match(section, /title="个人偏好"/);
  assert.match(section, /<MemberPreferencePanel \/>/);
});

test("settings first screen pushes governance, credentials, and notifications into advanced settings", () => {
  const source = settingsSource();

  assert.match(source, /data-testid="settings-advanced-link"/);
  assert.match(source, /href="\/settings\/advanced"/);
  assert.match(source, /管理不常改的设置/);
  assert.match(source, /团队规则、凭据和通知都放到单独一页，需要时再进入。/);
});

test("settings member preferences keep default entry on customer-facing routes with plain labels", () => {
  const source = settingsSource();

  assert.match(source, /import \{ START_ROUTE_OPTIONS, startRouteLabel \} from "@\/lib\/start-route";/);
  assert.match(source, /<FactTile label="默认入口" value=\{startRouteLabel\(currentMember\.preferences\.startRoute\)\} testID="settings-member-start-route-value" \/>/);
  assert.match(source, /\{START_ROUTE_OPTIONS\.map\(\(route\) => \([\s\S]*<option key=\{route\} value=\{route\}>\s*\{startRouteLabel\(route\)\}\s*<\/option>/);
  assert.doesNotMatch(source, /const START_ROUTE_OPTIONS = \["\/chat\/all", "\/rooms", "\/inbox", "\/mailbox", "\/setup", "\/board", "\/settings", "\/access"\]/);
});

test("settings routes split primary and advanced pages", () => {
  assert.match(settingsPageSource(), /LiveSettingsRoute/);
  assert.match(settingsAdvancedPageSource(), /LiveSettingsAdvancedRoute/);

  const source = settingsSource();
  assert.match(source, /<LiveSettingsView notifications=\{notifications\} mode="primary" \/>/);
  assert.match(source, /<LiveSettingsView notifications=\{notifications\} mode="advanced" \/>/);
});

test("settings first screen surfaces machine pairing and memory benefit before quota detail", () => {
  const panel = sectionBetween(
    settingsSource(),
    "function WorkspacePlanObservabilityPanel()",
    "function SettingsOverviewPanel()"
  );

  assert.match(panel, /先把机器连好，让记忆持续可用/);
  assert.match(panel, /label="机器配对"/);
  assert.match(panel, /label="记忆收益"/);
  assert.match(panel, /data-testid="settings-workspace-quota-details"/);

  const pairingIndex = panel.indexOf('label="机器配对"');
  const memoryIndex = panel.indexOf('label="记忆收益"');
  const quotaDetailsIndex = panel.indexOf('data-testid="settings-workspace-quota-details"');
  assert.notEqual(pairingIndex, -1, "machine pairing status should be rendered");
  assert.notEqual(memoryIndex, -1, "memory benefit status should be rendered");
  assert.notEqual(quotaDetailsIndex, -1, "quota details should be rendered");
  assert.ok(pairingIndex < quotaDetailsIndex, "machine pairing should show before quota details");
  assert.ok(memoryIndex < quotaDetailsIndex, "memory benefit should show before quota details");
});

test("settings first screen keeps secondary workspace facts behind a disclosure", () => {
  const panel = sectionBetween(
    settingsSource(),
    "function SettingsOverviewPanel() {",
    "function WorkspaceDurableConfigPanel() {"
  );

  assert.match(panel, /data-testid="settings-overview-support-details"/);
  assert.match(panel, /data-testid="settings-overview-support-toggle"/);
  assert.match(panel, /testID="settings-overview-template"/);
  assert.match(panel, /testID="settings-overview-sandbox"/);
  assert.match(panel, /testID="settings-overview-preferred-agent"/);
});

test("settings config recovery flow opens workspace and member disclosures before editing", () => {
  const script = configRecoveryScript();

  assert.match(script, /openSettingsDisclosure\(page, "workspace"/);
  assert.match(script, /openSettingsDisclosure\(page, "member"/);
});

test("settings context rail keeps status facts instead of repeating the primary next step", () => {
  const rail = sectionBetween(
    settingsSource(),
    "function LiveSettingsContextRail() {",
    "function WorkspacePlanObservabilityPanel()"
  );

  assert.doesNotMatch(rail, /label: "下一步"/);
  assert.match(rail, /label: "GitHub"/);
  assert.match(rail, /label: "记忆"/);
  assert.match(rail, /memoryBenefitSummary\(workspace\.memoryMode\)/);
});
