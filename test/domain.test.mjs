// Run with: node --test web/test
// Mirrors the iPhone app's Domain tests, so the web runner's records match what the app would write.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../js/domain.js";

test("day keys follow the crew's time zone", () => {
  const instant = new Date("2026-09-30T05:30:00Z"); // 22:30 on the 29th in Los Angeles
  assert.equal(D.dayKey(instant, "America/Los_Angeles"), "2026-09-29");
  assert.equal(D.dayKey(instant, "Europe/London"), "2026-09-30");
});

test("ISO week keys, including the year boundary", () => {
  assert.equal(D.weekKeyForDay("2026-09-29"), "2026-W40");
  assert.equal(D.weekKeyForDay("2026-09-28"), "2026-W40"); // Monday
  assert.equal(D.weekKeyForDay("2026-09-27"), "2026-W39"); // Sunday
  assert.equal(D.weekKeyForDay("2027-01-01"), "2026-W53");
  assert.equal(D.weekKeyForDay("2025-12-29"), "2026-W01");
});

test("day arithmetic crosses DST and month ends as calendar days", () => {
  assert.equal(D.addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(D.addDays("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(D.weekDayKeys("2026-10-01"), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(D.daysElapsedInWeek("2026-10-04"), 7);
});

test("the baseline window is the four weeks before this week", () => {
  const keys = D.baselineDayKeys("2026-09-30");
  assert.equal(keys.length, 28);
  assert.equal(keys[0], "2026-08-31");
  assert.equal(keys[27], "2026-09-27");
});

test("baseline averages 28 days, unfloored: the floor comes after the strength", () => {
  const steps = Object.fromEntries(D.baselineDayKeys("2026-09-30").map((k) => [k, 8400]));
  assert.equal(D.baselineDailyAverage(steps, "2026-09-30"), 8400);
  assert.equal(D.baselineDailyAverage({}, "2026-09-30"), 0);
});

test("streaks: today only extends once the goal is met", () => {
  assert.deepEqual(D.streaks([9000, 9000, 1000], 8000), { current: 2, best: 2 });
  assert.deepEqual(D.streaks([9000, 9000, 9000], 8000), { current: 3, best: 3 });
  assert.deepEqual(D.streaks([9000, 100, 9000, 9000, 9000, 9000], 8000), { current: 4, best: 4 });
});

test("baseline rolls once a week into the prev fields", () => {
  const same = D.rollBaseline({ avg: 7000, weekKey: "2026-W40" }, { avg: 6000, weekKey: "2026-W39" }, "2026-W40", () => 1);
  assert.deepEqual(same, { current: { avg: 7000, weekKey: "2026-W40" }, previous: { avg: 6000, weekKey: "2026-W39" } });
  const next = D.rollBaseline({ avg: 7000, weekKey: "2026-W40" }, { avg: 6000, weekKey: "2026-W39" }, "2026-W41", () => 7500);
  assert.deepEqual(next, { current: { avg: 7500, weekKey: "2026-W41" }, previous: { avg: 7000, weekKey: "2026-W40" } });
});

const crew = { code: "K7Q2MX", timeZoneID: "America/Los_Angeles", dailyGoal: 8000, startDayKey: "2026-10-01", endDayKey: "2026-10-31" };
const profile = { displayName: "Rae", avatarEmoji: "🦊", dailyGoal: 8000 };

test("a new web runner has no baseline of their own, so boards use the crew median", () => {
  const totals = D.historyTotals([], 7400, "2026-10-05", "2026-10-05");
  const summary = D.buildSummary({ id: "p_x", profile, crew, totals, previous: null, todayKey: "2026-10-05", now: 0 });
  assert.equal(summary.baselineDailyAvg, 0);
  assert.equal(D.effectiveBaseline({ strength: 100, median: 9100 }, summary.baselineDailyAvg), 9100);
  assert.equal(summary.baselineWeekKey, "2026-W41");
  assert.equal(summary.selfReported, true);
  assert.equal(summary.lastActiveAt, null);
  assert.equal(summary.todaySteps, 7400);
  assert.equal(summary.weekSteps, 7400);
});

test("fourteen logged days in the locked window switch to the runner's own average", () => {
  const lock = D.lockDayKeys("2026-10-01");
  assert.equal(lock[0], "2026-09-03");
  assert.equal(lock[27], "2026-09-30");
  const existing = lock.slice(-14).map((dayKey) => ({ dayKey, steps: 14000 }));
  const entries = Object.fromEntries(existing.map((d) => [d.dayKey, d.steps]));
  const totals = D.historyTotals(existing, 5000, "2026-10-05", "2026-10-05");
  const summary = D.buildSummary({ id: "p_x", profile, crew, totals, entries, previous: null, todayKey: "2026-10-05", now: 0 });
  assert.equal(summary.baselineDailyAvg, 7000);
  const thirteen = Object.fromEntries(lock.slice(-13).map((k) => [k, 14000]));
  assert.equal(D.selfReportedBaseline(thirteen, crew, "2026-10-05"), 0);
});

test("the locked baseline holds across Mondays; weekly crews recompute", () => {
  const lock = D.lockDayKeys("2026-10-01");
  const entries = Object.fromEntries(lock.map((k) => [k, 9000]));
  for (let day = 0; day < 28; day++) entries[D.addDays("2026-10-01", day)] = 20000; // a huge October
  for (const today of ["2026-10-01", "2026-10-05", "2026-10-12", "2026-10-26", "2026-11-09"]) {
    assert.equal(D.selfReportedBaseline(entries, crew, today), 9000, today);
  }
  const weekly = { code: "X" };
  assert.equal(D.selfReportedBaseline(entries, weekly, "2026-10-05"), Math.floor((24 * 9000 + 4 * 20000) / 28));
  assert.equal(D.selfReportedBaseline(entries, weekly, "2026-11-02"), Math.floor((24 * 20000) / 28)); // Oct 5 – Nov 1
  // In the warm-up the window isn't locked yet.
  assert.deepEqual(D.baselineWindowKeys(crew, "2026-09-29"), D.baselineDayKeys("2026-09-29"));
});

test("strength: Full, Half, Off and the floor after", () => {
  const at = (strength, own) => D.effectiveBaseline({ strength, median: 8000 }, own);
  assert.deepEqual([at(100, 18000), at(50, 18000), at(0, 18000)], [18000, 13000, 8000]);
  assert.deepEqual([at(100, 4000), at(50, 4000), at(0, 4000)], [4000, 6000, 8000]);
  // The floor comes last: 2,000 at Full is 3,000, at Half it's 5,000 (no floor needed).
  assert.deepEqual([at(100, 2000), at(50, 2000)], [3000, 5000]);
  assert.equal(D.effectiveBaseline({ strength: 50, median: 3500 }, 1000), 3000);
  // Truncates toward zero, like Swift's integer division.
  assert.equal(D.effectiveBaseline({ strength: 50, median: 8000 }, 8001), 8000);
  assert.equal(D.effectiveBaseline({ strength: 50, median: 8000 }, 7999), 8000);
  assert.equal(D.handicapStrength({}), 50);
  assert.equal(D.handicapStrength({ handicapStrength: 0 }), 0);
});

test("the crew median counts every own baseline, not typed-in runners still borrowing", () => {
  const players = [
    { id: "p_a", baselineDailyAvg: 6000 },
    { id: "p_b", baselineDailyAvg: 9000 },
    { id: "p_c", baselineDailyAvg: 12000 },
    { id: "p_guest_1", baselineDailyAvg: 0 },
    { id: "p_web", baselineDailyAvg: 15000, selfReported: true },
  ];
  assert.equal(D.crewMedianBaseline(players), 9000);
  assert.equal(D.crewMedianBaseline([{ id: "p_guest_1", baselineDailyAvg: 0 }]), null);
});

test("entries clamp to 0…100,000 and replace the day", () => {
  const totals = D.historyTotals([{ dayKey: "2026-10-05", steps: 3000 }], 250000, "2026-10-05", "2026-10-05");
  assert.equal(totals.at(-1).steps, 100000);
  assert.equal(totals.length, 35);
  assert.equal(D.clampSteps(-5), 0);
  assert.equal(D.clampSteps("abc"), 0);
});

test("window board at Full: handicap by each day's stamped baseline, ties share a rank", () => {
  const p = (id, name, baseline) => ({ id, displayName: name, baselineDailyAvg: baseline, baselineWeekKey: "2026-W41", prevBaselineDailyAvg: 0, prevBaselineWeekKey: "", weekKey: "2026-W41", weekSteps: 0 });
  const players = [p("p_a", "Ana", 5000), p("p_b", "Bo", 10000), p("p_c", "Cy", 8000)];
  const daySteps = [
    { playerID: "p_a", dayKey: "2026-10-05", steps: 6000, baselineDailyAvg: 5000 },
    { playerID: "p_b", dayKey: "2026-10-05", steps: 12000, baselineDailyAvg: 10000 },
    { playerID: "p_c", dayKey: "2026-10-05", steps: 8000, baselineDailyAvg: 8000 },
  ];
  const full = { ...crew, handicapStrength: 100 };
  const board = D.standings({ players, daySteps, crew: full, todayKey: "2026-10-05", metric: "week", mode: "handicap" });
  assert.deepEqual(board.map((s) => [s.player.id, s.rank, s.isTied, s.percent]), [
    ["p_a", 1, true, 120],
    ["p_b", 1, true, 120],
    ["p_c", 3, false, 100],
  ]);
  // Half (the default) pulls 5,000 and 10,000 halfway to the 8,000 median: 6,500 and 9,000.
  const half = D.standings({ players, daySteps, crew, todayKey: "2026-10-05", metric: "week", mode: "handicap" });
  assert.deepEqual(half.map((s) => [s.player.id, s.expected, s.percent]), [["p_b", 9000, 133], ["p_c", 8000, 100], ["p_a", 6500, 92]]);
  const raw = D.standings({ players, daySteps, crew, todayKey: "2026-10-05", metric: "week", mode: "raw" });
  assert.deepEqual(raw.map((s) => s.player.id), ["p_b", "p_c", "p_a"]);
});

test("before the start the board reads Player summaries, stale weeks count as zero", () => {
  const players = [
    { id: "p_a", displayName: "Ana", baselineDailyAvg: 5000, weekKey: "2026-W40", weekSteps: 10000 },
    { id: "p_b", displayName: "Bo", baselineDailyAvg: 5000, weekKey: "2026-W39", weekSteps: 90000 },
  ];
  const board = D.standings({ players, daySteps: [], crew, todayKey: "2026-09-29", metric: "week", mode: "handicap" });
  assert.equal(board[0].player.id, "p_a");
  assert.equal(board[1].steps, 0);
});

test("enterable days: the last 35, never past the finish, including days before the start", () => {
  const live = D.enterableDayKeys(crew, "2026-10-03");
  assert.equal(live.length, 35);
  assert.equal(live[0], "2026-10-03");
  assert.ok(live.includes("2026-09-20")); // counts toward the 14 logged days
  assert.equal(D.enterableDayKeys(crew, "2026-11-05")[0], "2026-10-31");
  assert.equal(D.enterableDayKeys({ code: "X" }, "2026-09-29").length, 35);
});

test("app and web score the shared fixture identically (JimothyTests/HandicapFixtureTests)", () => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/handicap-v2.json", import.meta.url)));
  assert.equal(f.cases.length, 9);
  for (const c of f.cases) {
    const crew = { ...f.crew, handicapStrength: c.strength, ...(c.dates ? {} : { startDayKey: null, endDayKey: null }) };
    const board = D.standings({ players: f.players, daySteps: f.daySteps, crew, todayKey: f.todayKey, metric: c.metric, mode: "handicap" });
    assert.deepEqual(board.map((s) => [s.player.id, s.rank, s.isTied, s.steps, s.expected, s.percent]), c.expect, `${c.strength} ${c.dates} ${c.metric}`);
  }
});

test("the web explainer uses the app's words (HandicapCopy)", () => {
  const swift = readFileSync(new URL("../../Jimothy/Features/Board/HandicapExplainer.swift", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const lines = [...swift.matchAll(/static let \w+ = "(.*)"\n/g)].map((m) => m[1]);
  assert.equal(lines.length, 6);
  for (const line of lines) assert.ok(html.includes(`<p>${line}</p>`), line.slice(0, 40));
});

test("crew codes sanitize like the app", () => {
  assert.equal(D.sanitizeCrewCode(" k7q-2mx0o1 "), "K7Q2MX");
  assert.ok(D.isValidCrewCode("K7Q2MX"));
  assert.ok(!D.isValidCrewCode("K7Q2M"));
});
