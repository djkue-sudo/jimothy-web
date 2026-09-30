// A stand-in for cloud.js with an in-memory crew, for checking the page on localhost without an
// Apple sign-in (like the app's Mock data source). app.js only loads it on localhost with `?mock`.
// `?mock=live` runs a competition that started this month; `?mock=warmup` one that hasn't started.

import * as D from "./domain.js";

const params = new URLSearchParams(location.search);
const scenario = params.get("mock") || "live";
const timeZoneID = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = D.dayKey(new Date(), timeZoneID);
const code = "K7Q2MX";

const crew = {
  code,
  name: "Third Floor Striders",
  timeZoneID,
  createdBy: "p__mike",
  dailyGoal: 8000,
  startDayKey: scenario === "warmup" ? D.addDays(today, 2) : D.addDays(today, -9),
  endDayKey: scenario === "warmup" ? D.addDays(today, 32) : D.addDays(today, 21),
};

function phone(id, name, emoji, baseline, daily) {
  return {
    player: {
      id, displayName: name, avatarEmoji: emoji, dailyGoal: 8000, crewCode: code,
      todayKey: today, todaySteps: daily, weekKey: D.weekKeyForDay(today), weekSteps: daily * D.daysElapsedInWeek(today),
      weekDistanceM: 0, currentStreak: 3, bestStreak: 5,
      baselineDailyAvg: baseline, baselineWeekKey: D.weekKeyForDay(today), prevBaselineDailyAvg: baseline, prevBaselineWeekKey: "",
      lastActiveAt: null, badgeIDs: [], selfReported: false,
    },
    daily,
  };
}

const cast = [
  phone("p__priya", "Priya", "🌱", 6200, 12400),
  phone("p__jordan", "Jordan", "😤", 9800, 10600),
  phone("p__dana", "Dana", "👟", 14000, 14200),
  phone("p__sam", "Sam", "🔥", 11000, 9400),
  phone("p__leo", "Leo", "🐢", 5200, 4100),
];
const guest = phone("p_guest_rae", "Rae", "🦊", 9800, 7000);

const players = new Map([...cast, guest].map((c) => [c.player.id, c.player]));
const memberships = new Set([...players.keys()]);
const daySteps = new Map();
for (const c of [...cast, guest]) {
  for (const key of D.dayKeysEndingOn(today, 35)) {
    const wobble = ((key.charCodeAt(9) * 37) % 9) * 250 - 1000;
    daySteps.set(`${c.player.id}_${key}`, { playerID: c.player.id, crewCode: code, dayKey: key, steps: Math.max(c.daily + wobble, 0), baselineDailyAvg: c.player.baselineDailyAvg });
  }
}

const me = "p__webrunner";
// `&joined` starts already on the crew, as a web runner with two entered days.
if (params.has("joined")) {
  const web = phone(me, "Kim", "🐸", 9800, 9200).player;
  web.selfReported = true;
  players.set(me, web);
  memberships.add(me);
  for (const [offset, steps] of [[0, 9200], [-1, 11500]]) {
    const key = D.addDays(today, offset);
    daySteps.set(`${me}_${key}`, { playerID: me, crewCode: code, dayKey: key, steps, baselineDailyAvg: 9800 });
  }
}
const delay = () => new Promise((r) => setTimeout(r, 250));

export async function setUp() {
  await delay();
  return params.get("signedout") ? null : "_webrunner";
}
export function environmentName() { return `mock, ${scenario}`; }
export async function fetchPlayer(id) { await delay(); return players.get(id) ?? null; }
export async function fetchCrew(c) { await delay(); return c === code ? crew : null; }
export async function isMember(c, id) { return c === code && memberships.has(id); }
export async function crewPlayers() { await delay(); return [...memberships].map((id) => players.get(id)).filter(Boolean); }
export async function crewDaySteps(c, keys) {
  const wanted = new Set(keys);
  return [...daySteps.values()].filter((d) => wanted.has(d.dayKey));
}
export async function savePlayer(p) { await delay(); players.set(p.id, { ...p }); }
export async function joinCrew(c, id) { await delay(); memberships.add(id); }
export async function saveDaySteps(d) { await delay(); daySteps.set(`${d.playerID}_${d.dayKey}`, { ...d }); }
export const mockPlayerID = me;
