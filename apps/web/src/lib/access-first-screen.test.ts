import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const accessPagePath = resolve(__dirname, "../app/access/page.tsx");
const accessSourcePath = resolve(__dirname, "../components/live-access-views.tsx");

function accessPageSource() {
  return readFileSync(accessPagePath, "utf8");
}

function accessSource() {
  return readFileSync(accessSourcePath, "utf8");
}

function sectionBetween(source: string, startPattern: string, endPattern: string) {
  const start = source.indexOf(startPattern);
  assert.notEqual(start, -1, `section start ${startPattern} should exist`);
  const end = source.indexOf(endPattern, start);
  assert.notEqual(end, -1, `section end ${endPattern} should exist`);
  return source.slice(start, end);
}

test("access page copy keeps the route focused on getting back into the workspace", () => {
  const source = accessPageSource();

  assert.match(source, /title="回到同一条工作对话"/);
  assert.match(source, /description="账号可用就回聊天；需要恢复时只补当前这一步。"/);
  assert.match(source, /contextDescription="能进入就继续聊，缺一步就补一步。"/);
});

test("access overview leads with the next step before recovery controls", () => {
  const section = sectionBetween(
    accessSource(),
    "export function LiveAccessOverview() {",
    "<details data-testid=\"access-advanced-details\""
  );

  assert.match(section, /const primaryGatePanel = !accessReady/);
  assert.match(section, /\{!accessReady \? primaryGatePanel : null\}/);
  assert.match(section, /const showSessionAction = !accessReady && !sessionIsActive\(session\);/);
  assert.match(section, /const showRecovery = !accessReady && sessionIsActive\(session\);/);
  assert.match(section, /showSessionAction/);
  assert.match(section, /<SessionActionPanel session=\{session\} members=\{members\} \/>/);
  assert.match(section, /showRecovery/);
  assert.match(section, /<IdentityRecoveryPanel session=\{session\} members=\{members\} devices=\{devices\} \/>/);
  assert.match(section, /data-testid="access-next-step-details"/);
  assert.match(section, /data-testid="access-next-step-toggle"/);
  assert.match(section, /先完成上面的主步骤；需要时再展开完整首启说明。/);
  assert.doesNotMatch(section, /!accessReady \? <FirstStartJourneyPanel \/> : null/);
});

test("access overview drops the first-start panel once identity is ready", () => {
  const section = sectionBetween(
    accessSource(),
    "export function LiveAccessOverview() {",
    "<details data-testid=\"access-advanced-details\""
  );

  assert.match(section, /\{!accessReady \? \([\s\S]*<FirstStartJourneyPanel \/>[\s\S]*\) : null\}/);
});

test("access first-start panel keeps step details behind a disclosure while preserving script anchors", () => {
  const section = sectionBetween(
    accessSource(),
    "function FirstStartJourneyPanel() {",
    "export function LiveAccessContextRail() {"
  );

  assert.match(section, /data-testid="access-first-start-next-route"/);
  assert.match(section, /data-testid="access-first-start-next-link"/);
  assert.match(section, /data-testid="access-first-start-steps-details"/);
  assert.match(section, /data-testid="access-first-start-steps-toggle"/);
  assert.match(section, /data-testid={`access-first-start-step-\$\{step\.id\}-summary`}/);
  assert.match(section, /data-testid={`access-first-start-step-\$\{step\.id\}-status`}/);
  assert.match(section, /需要时再展开三步说明，先按上面的下一步继续。/);
});

test("access advanced area keeps account operations secondary and removes explicit permission-check framing", () => {
  const source = accessSource();

  assert.match(source, /更多账号操作/);
  assert.match(source, /高级入口/);
  assert.match(source, /需要时再看可进入的页面/);
  assert.match(source, /平时只要能登录并继续工作就够了。只有排查权限或跳到特定页面时，再展开下面这些入口。/);
  assert.doesNotMatch(source, /切换成员和更多设置/);
  assert.doesNotMatch(source, /当前身份能做什么/);
  assert.doesNotMatch(source, /权限检查/);
});

test("access recovery keeps reset and identity binding behind a secondary disclosure", () => {
  const section = sectionBetween(
    accessSource(),
    "function IdentityRecoveryPanel({",
    "function AccessReadyPanel({"
  );

  assert.match(section, /data-testid="access-recovery-secondary-details"/);
  assert.match(section, /data-testid="access-recovery-secondary-toggle"/);
  assert.match(section, /其他恢复方式/);
  assert.match(section, /data-testid="access-request-reset-submit"/);
  assert.match(section, /data-testid="access-complete-reset-challenge-id"/);
  assert.match(section, /data-testid="access-complete-reset-submit"/);
  assert.match(section, /data-testid="access-bind-identity-submit"/);
  assert.match(section, /先在仍可登录的设备上发起重置，再把 challenge ID 带到这里完成恢复。/);
});

test("access context rail keeps only login, identity, member, and next-step signals", () => {
  const section = sectionBetween(
    accessSource(),
    "export function LiveAccessContextRail() {",
    "export function LiveAccessOverview() {"
  );

  assert.match(section, /label: "登录"/);
  assert.match(section, /label: "身份"/);
  assert.match(section, /label: "成员"/);
  assert.match(section, /label: "下一步"/);
  assert.doesNotMatch(section, /label: "权限"/);
  assert.doesNotMatch(section, /label: "恢复"/);
});
