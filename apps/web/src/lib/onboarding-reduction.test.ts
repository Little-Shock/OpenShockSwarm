import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const onboardingSourcePath = resolve(__dirname, "../components/onboarding-wizard.tsx");

function onboardingSource() {
  return readFileSync(onboardingSourcePath, "utf8");
}

function sectionBetween(source: string, startPattern: string, endPattern: string) {
  const start = source.indexOf(startPattern);
  assert.notEqual(start, -1, `section start ${startPattern} should exist`);
  const end = source.indexOf(endPattern, start);
  assert.notEqual(end, -1, `section end ${endPattern} should exist`);
  return source.slice(start, end);
}

test("account submit advances to the next ready step instead of stopping on template", () => {
  const section = sectionBetween(
    onboardingSource(),
    "async function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {",
    "async function handleTemplateSelect(templateID: string) {"
  );

  assert.match(section, /const nextStep = derivedCurrentStep\(/);
  assert.match(section, /templateReady,/);
  assert.match(section, /addCompleted: \["account-ready"\]/);
  assert.match(section, /setCurrentStep\(nextStep\)/);
  assert.doesNotMatch(section, /template-selected/);
});

test("runtime pairing can advance straight to finish when the default agent already exists", () => {
  const section = sectionBetween(
    onboardingSource(),
    "async function handlePairRuntime() {",
    "async function handleSaveAgent(event: FormEvent<HTMLFormElement>) {"
  );

  assert.match(section, /const nextStep: WizardStepID = starterAgent \? "finish" : "agent"/);
  assert.match(section, /addCompleted: starterAgent \? \["runtime-paired", "agent-configured"\] : \["runtime-paired"\]/);
  assert.match(section, /setCurrentStep\(nextStep\)/);
  assert.match(section, /运行环境已连接，默认智能体已就绪。/);
});

test("onboarding keeps finish and future steps gated until repo and runtime are ready", () => {
  const source = onboardingSource();
  const finishSection = sectionBetween(
    source,
    "async function handleFinish() {",
    "function goBack() {"
  );

  assert.match(finishSection, /if \(!repoReady\)/);
  assert.match(finishSection, /if \(!runtimeReady\)/);
  assert.match(finishSection, /setCurrentStep\("repo"\)/);
  assert.match(finishSection, /setCurrentStep\("runtime"\)/);
  assert.match(source, /const finishDestination = continueTarget\.source === "journey" \? journey\.launchHref : continueTarget\.href;/);
  assert.match(source, /router\.replace\(finishDestination\);/);
  assert.match(source, /resumeUrl: done \? finishDestination : "\/setup"/);
  assert.match(finishSection, /startRoute: currentMember\.preferences\.startRoute\?\.trim\(\) \|\| journey\.launchHref,/);
  assert.match(finishSection, /router\.push\(finishDestination\);/);
  assert.doesNotMatch(finishSection, /startRoute: "\/chat\/all"/);
  assert.doesNotMatch(finishSection, /router\.push\("\/chat\/all"\)/);
  assert.match(source, /const onboardingDone = state\.workspace\.onboarding\.status === "done";/);
  assert.match(source, /function canOpenStep\(stepID: WizardStepID\)/);
  assert.match(source, /onClick=\{\(\) => openStep\(step\.id\)\}/);
  assert.match(source, /disabled=\{!canOpenStep\(step\.id\)\}/);
  assert.match(source, /disabled=\{busy \|\| onboardingDone \|\| !finishReady\}/);
});

test("onboarding copy tells users they can start first and finish setup later", () => {
  const source = onboardingSource();

  assert.match(source, /通常只要账号、仓库和机器就能开始；GitHub 与更多设置可以稍后补。/);
  assert.match(source, /系统会先给你一个推荐模板，确认后随时都能回来修改。/);
  assert.match(source, /系统会先推荐开发团队，你也可以改成研究或空白。/);
  assert.match(source, /optional: true/);
  assert.match(source, /稍后可补/);
  assert.match(source, /可选/);
  assert.match(source, /默认已准备好，需要时再改。/);
  assert.match(source, /显示名（可选）/);
  assert.match(source, /设备名称（可选）/);
  assert.match(source, /data-testid="onboarding-runtime-advanced"/);
});
