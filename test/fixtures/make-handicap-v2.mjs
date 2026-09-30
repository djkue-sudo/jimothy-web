// Writes handicap-v2.json: one crew's records and the boards they must produce. The app's
// HandicapFixtureTests and the web's domain tests both score it and must match these numbers exactly.
// Run: node web/test/fixtures/make-handicap-v2.mjs (only when the rules change on purpose).
import { writeFileSync } from "node:fs";
import * as D from "../../js/domain.js";

const crew = { code: "K7Q2MX", name: "Fixture", timeZoneID: "America/Los_Angeles", createdBy: "p_wren", dailyGoal: 8000, startDayKey: "2026-10-01", endDayKey: "2026-10-31" };
const todayKey = "2026-10-06"; // Tuesday of week 2: two days this week, six overall
const player = (id, displayName, baseline, weekSteps, extra = {}) => ({
  id, displayName, avatarEmoji: "🦝", dailyGoal: 8000, crewCode: crew.code, todayKey, todaySteps: 0,
  weekKey: "2026-W41", weekSteps, weekDistanceM: 0, currentStreak: 0, bestStreak: 0,
  baselineDailyAvg: baseline, baselineWeekKey: "2026-W41", prevBaselineDailyAvg: baseline, prevBaselineWeekKey: "2026-W40",
  badgeIDs: [], selfReported: false, ...extra,
});
const players = [
  player("p_wren", "Wren", 18000, 40000),   // the 18,000-a-day walker
  player("p_sol", "Sol", 4000, 16000),      // the 4,000-a-day walker
  player("p_mo", "Mo", 8000, 17000),
  player("p_pia", "Pia", 10000, 18000),
  player("p_guest_gus", "Gus", 0, 16000),   // a guest with under 14 days: borrows the median
  player("p_rae", "Rae", 2000, 11000, { selfReported: true }), // web runner with their own, below the floor
];
const days = { p_wren: [20000, 20000], p_sol: [8000, 8000], p_mo: [9000, 8000], p_pia: [9000, 9000], p_guest_gus: [10000, 6000], p_rae: [6000, 5000] };
const daySteps = Object.entries(days).flatMap(([playerID, steps]) => ["2026-10-05", "2026-10-06"].map((dayKey, i) => ({
  playerID, crewCode: crew.code, dayKey, steps: steps[i], baselineDailyAvg: players.find((p) => p.id === playerID).baselineDailyAvg,
})));

const cases = [];
for (const strength of [100, 50, 0]) {
  for (const [dates, metric] of [[true, "week"], [true, "overall"], [false, "week"]]) {
    const c = { ...crew, handicapStrength: strength, ...(dates ? {} : { startDayKey: null, endDayKey: null }) };
    const board = D.standings({ players, daySteps, crew: c, todayKey, metric, mode: "handicap" });
    cases.push({ strength, dates, metric, expect: board.map((s) => [s.player.id, s.rank, s.isTied, s.steps, s.expected, s.percent]) });
  }
}
writeFileSync(new URL("./handicap-v2.json", import.meta.url), JSON.stringify({ crew, todayKey, players, daySteps, cases }, null, 1) + "\n");
