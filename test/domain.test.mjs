// Run with: node --test web/test
// Mirrors the iPhone app's Domain tests, so the web runner's records match what the app would write.
import test from "node:test";
import assert from "node:assert/strict";
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

test("baseline averages 28 days and floors at 3,000", () => {
  const steps = Object.fromEntries(D.baselineDayKeys("2026-09-30").map((k) => [k, 8400]));
  assert.equal(D.baselineDailyAverage(steps, "2026-09-30"), 8400);
  assert.equal(D.baselineDailyAverage({}, "2026-09-30"), 3000);
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

test("a new web runner borrows the crew median baseline, not the floor", () => {
  const totals = D.historyTotals([], 7400, "2026-10-05", "2026-10-05");
  const summary = D.buildSummary({ id: "p_x", profile, crew, totals, previous: null, todayKey: "2026-10-05", now: 0, crewMedian: 9100 });
  assert.equal(summary.baselineDailyAvg, 9100);
  assert.equal(summary.baselineWeekKey, "2026-W41");
  assert.equal(summary.selfReported, true);
  assert.equal(summary.lastActiveAt, null);
  assert.equal(summary.todaySteps, 7400);
  assert.equal(summary.weekSteps, 7400);
});

test("fourteen entered baseline days switch to the runner's own average", () => {
  const baseline = D.baselineDayKeys("2026-10-05");
  const existing = baseline.slice(-14).map((dayKey) => ({ dayKey, steps: 14000 }));
  const totals = D.historyTotals(existing, 5000, "2026-10-05", "2026-10-05");
  const summary = D.buildSummary({ id: "p_x", profile, crew, totals, previous: null, todayKey: "2026-10-05", now: 0, crewMedian: 9100 });
  assert.equal(summary.baselineDailyAvg, Math.floor((14 * 14000) / 28));
});

test("the crew median ignores guests and web runners", () => {
  const players = [
    { id: "p_a", baselineDailyAvg: 6000 },
    { id: "p_b", baselineDailyAvg: 9000 },
    { id: "p_c", baselineDailyAvg: 12000 },
    { id: "p_guest_1", baselineDailyAvg: 3000 },
    { id: "p_web", baselineDailyAvg: 3000, selfReported: true },
  ];
  assert.equal(D.crewMedianBaseline(players), 9000);
  assert.equal(D.crewMedianBaseline([{ id: "p_guest_1", baselineDailyAvg: 5000 }]), null);
});

test("entries clamp to 0…100,000 and replace the day", () => {
  const totals = D.historyTotals([{ dayKey: "2026-10-05", steps: 3000 }], 250000, "2026-10-05", "2026-10-05");
  assert.equal(totals.at(-1).steps, 100000);
  assert.equal(totals.length, 35);
  assert.equal(D.clampSteps(-5), 0);
  assert.equal(D.clampSteps("abc"), 0);
});

test("window board: handicap by each day's stamped baseline, ties share a rank", () => {
  const p = (id, name, baseline) => ({ id, displayName: name, baselineDailyAvg: baseline, baselineWeekKey: "2026-W41", prevBaselineDailyAvg: 0, prevBaselineWeekKey: "", weekKey: "2026-W41", weekSteps: 0 });
  const players = [p("p_a", "Ana", 5000), p("p_b", "Bo", 10000), p("p_c", "Cy", 8000)];
  const daySteps = [
    { playerID: "p_a", dayKey: "2026-10-05", steps: 6000, baselineDailyAvg: 5000 },
    { playerID: "p_b", dayKey: "2026-10-05", steps: 12000, baselineDailyAvg: 10000 },
    { playerID: "p_c", dayKey: "2026-10-05", steps: 8000, baselineDailyAvg: 8000 },
  ];
  const board = D.standings({ players, daySteps, crew, todayKey: "2026-10-05", metric: "week", mode: "handicap" });
  assert.deepEqual(board.map((s) => [s.player.id, s.rank, s.isTied, s.percent]), [
    ["p_a", 1, true, 120],
    ["p_b", 1, true, 120],
    ["p_c", 3, false, 100],
  ]);
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

test("enterable days: the competition so far, else the last 35 days", () => {
  assert.deepEqual(D.enterableDayKeys(crew, "2026-10-03"), ["2026-10-03", "2026-10-02", "2026-10-01"]);
  assert.deepEqual(D.enterableDayKeys(crew, "2026-09-29"), []);
  assert.equal(D.enterableDayKeys({ code: "X" }, "2026-09-29").length, 35);
});

test("crew codes sanitize like the app", () => {
  assert.equal(D.sanitizeCrewCode(" k7q-2mx0o1 "), "K7Q2MX");
  assert.ok(D.isValidCrewCode("K7Q2MX"));
  assert.ok(!D.isValidCrewCode("K7Q2M"));
});
