// Jimothy's rules, ported from the iPhone app's Domain folder so a self-reported web runner's
// records are indistinguishable from the app's own. Pure functions only: no CloudKit, no DOM.
// Each block names the Swift type it mirrors; keep them in step.

// MARK: Constants (Models.swift, Scoring.swift, GuestEntry.swift, CrewCode.swift)

export const DAILY_GOAL_STANDARD = 8000;
export const BASELINE_FLOOR = 3000;
export const HISTORY_DAYS = 35;
export const MAX_STEPS = 100000;
export const MIN_BASELINE_DAYS = 14;
export const MAX_NAME_LENGTH = 20;
export const GUEST_PREFIX = "p_guest_";
export const CREW_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CREW_CODE_LENGTH = 6;
/** The runner emoji the app offers (RunnerPicker.choices). */
export const RUNNER_EMOJI = ["🦝", "👟", "🔥", "🌱", "🐢", "😤", "🦊", "🐸", "🐙", "🦄", "🐝", "🌮"];

// MARK: Crew codes (CrewCode.swift)

/** Uppercases and drops anything outside the alphabet, capped at six characters. */
export function sanitizeCrewCode(input) {
  return [...String(input).toUpperCase()].filter((c) => CREW_CODE_ALPHABET.includes(c)).slice(0, CREW_CODE_LENGTH).join("");
}

export function isValidCrewCode(code) {
  return code.length === CREW_CODE_LENGTH && [...code].every((c) => CREW_CODE_ALPHABET.includes(c));
}

// MARK: Calendar (CompetitionCalendar.swift)
//
// Days and weeks are measured in the crew's time zone, weeks start Monday (ISO 8601).
// Day arithmetic works on calendar dates (UTC midnight stand-ins), so DST never shifts a day.

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

/** The crew-time-zone calendar date of an instant, as {y, m, d}. */
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function keyFromUTC(utc) {
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

function utcFromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `"2026-09-29"` for an instant, in the crew's time zone. */
export function dayKey(date, timeZone) {
  const { y, m, d } = zonedParts(date, timeZone);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The day key `days` after (or before) another. */
export function addDays(key, days) {
  const utc = utcFromKey(key);
  utc.setUTCDate(utc.getUTCDate() + days);
  return keyFromUTC(utc);
}

/** `"2026-W40"`: the ISO week of a day key. */
export function weekKeyForDay(key) {
  const utc = utcFromKey(key);
  const weekday = utc.getUTCDay() || 7; // Monday 1 … Sunday 7
  const thursday = new Date(utc);
  thursday.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday - jan1) / 86400000 + 1) / 7);
  return `${year}-W${pad(week)}`;
}

/** Monday of the week containing a day key. */
export function mondayOf(key) {
  const weekday = utcFromKey(key).getUTCDay() || 7;
  return addDays(key, 1 - weekday);
}

/** Monday through Sunday of the week containing a day key. */
export function weekDayKeys(key) {
  const monday = mondayOf(key);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
}

/** 1 on Monday through 7 on Sunday. */
export function daysElapsedInWeek(key) {
  return utcFromKey(key).getUTCDay() || 7;
}

/** `count` consecutive day keys, oldest first, ending on `key`. */
export function dayKeysEndingOn(key, count) {
  return Array.from({ length: count }, (_, i) => addDays(key, i - count + 1));
}

/** The 28 day keys before the week containing `key`, oldest first: the baseline window. */
export function baselineDayKeys(key) {
  return dayKeysEndingOn(addDays(mondayOf(key), -1), 28);
}

// MARK: Competition window (CompetitionWindow.swift)

export function competitionWindow(crew) {
  const { startDayKey: start, endDayKey: end } = crew;
  if (!start || !end || start > end) return null;
  return { start, end };
}

export function phase(window, todayKey) {
  if (!window) return null;
  if (todayKey < window.start) return "warmUp";
  if (todayKey > window.end) return "finished";
  return "live";
}

export function windowDayKeys(window, throughKey) {
  const keys = [];
  for (let key = window.start, i = 0; key <= window.end && key <= throughKey && i < 400; key = addDays(key, 1), i++) keys.push(key);
  return keys;
}

// MARK: Streaks and baselines (Scoring.swift)

/** `steps` runs oldest to newest and ends today; today only extends the streak once the goal is met. */
export function streaks(steps, goal) {
  let best = 0;
  let run = 0;
  for (const value of steps) {
    run = value >= goal ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  for (const value of steps.slice(0, -1).reverse()) {
    if (value < goal) break;
    current += 1;
  }
  if (steps.length && steps[steps.length - 1] >= goal) current += 1;
  return { current, best };
}

/** A runner's own baseline over the 28 days before the week. Missing days count as zero. Not floored. */
export function baselineDailyAverage(stepsByDay, todayKey) {
  return averageOver(stepsByDay, baselineDayKeys(todayKey));
}

export function averageOver(stepsByDay, keys) {
  if (!keys.length) return 0;
  return Math.floor(keys.reduce((sum, key) => sum + (stepsByDay[key] ?? 0), 0) / keys.length);
}

// MARK: Handicap v2 (Scoring.swift Baseline, HandicapStrength, HandicapRule)

/** Full 100, Half 50 (a crew that never picked), Off 0. */
export const HANDICAP_STRENGTHS = { 100: "Full", 50: "Half", 0: "Off" };
export const HANDICAP_STRENGTH_STANDARD = 50;

export function handicapStrength(crew) {
  const s = crew?.handicapStrength;
  return s === 100 || s === 50 || s === 0 ? s : HANDICAP_STRENGTH_STANDARD;
}

/** The 28 days before a competition's start day, oldest first: the locked baseline's window. */
export function lockDayKeys(startDayKey) {
  return dayKeysEndingOn(addDays(startDayKey, -1), 28);
}

/** Baselines lock once a competition starts; crews without dates (and the warm-up) recompute weekly. */
export function baselineIsLocked(window, todayKey) {
  return window != null && phase(window, todayKey) !== "warmUp";
}

/** The days a baseline is averaged over today: the locked window, or the 28 days before this week. */
export function baselineWindowKeys(crew, todayKey) {
  const window = competitionWindow(crew);
  return baselineIsLocked(window, todayKey) ? lockDayKeys(window.start) : baselineDayKeys(todayKey);
}

/** 0 means "no baseline of their own yet". */
export function ownBaseline(raw) {
  return raw > 0 ? raw : null;
}

/** HandicapRule.median(of:): the lower median of every own baseline on the crew. */
export function crewMedianBaseline(players) {
  const baselines = players.map((p) => ownBaseline(p.baselineDailyAvg)).filter((b) => b != null);
  return baselines.length ? median(baselines) : null;
}

/** The crew's rule for every Handicap board. */
export function handicapRule(crew, players) {
  return { strength: handicapStrength(crew), median: crewMedianBaseline(players) };
}

/** The same rule as the app before strength existed: own baseline, floored. */
export const UNADJUSTED = { strength: 100, median: null };

/**
 * HandicapRule.effective: crew median + strength × (own − median), then the 3,000 floor.
 * No own baseline uses the median. Integer arithmetic truncating toward zero, as Swift's `/` does.
 */
export function effectiveBaseline(rule, raw) {
  if (rule.median == null) return Math.max(raw, BASELINE_FLOOR);
  const own = ownBaseline(raw) ?? rule.median;
  return Math.max(rule.median + Math.trunc((rule.strength * (own - rule.median)) / 100), BASELINE_FLOOR);
}

/** MatchupEngine.median: the lower middle of the sorted values. */
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// MARK: Self-reported runners (Models.swift, GuestEntry.swift)

/** Guests (entered by the crew's creator) and web runners both type their steps in. */
export function isSelfReported(player) {
  return player.id.startsWith(GUEST_PREFIX) || player.selfReported === true;
}

/**
 * GuestEntry.ownBaseline: a typed-in runner's average over the baseline window once they've logged 14 of
 * those days, else 0 (every board then uses the crew median). `entries` maps day keys to steps.
 */
export function selfReportedBaseline(entries, crew, todayKey) {
  const keys = baselineWindowKeys(crew, todayKey);
  const logged = keys.filter((k) => (entries[k] ?? 0) > 0).length;
  return logged < MIN_BASELINE_DAYS ? 0 : averageOver(entries, keys);
}

/** The runner's 35-day history, oldest first, with one day replaced by the entered value. */
export function historyTotals(existing, enteringSteps, onDayKey, todayKey) {
  const byDay = {};
  for (const day of existing) byDay[day.dayKey] = Math.max(byDay[day.dayKey] ?? 0, day.steps);
  if (onDayKey != null) byDay[onDayKey] = clampSteps(enteringSteps);
  return dayKeysEndingOn(todayKey, HISTORY_DAYS).map((key) => ({ dayKey: key, steps: byDay[key] ?? 0 }));
}

export function clampSteps(steps) {
  const n = Math.floor(Number(steps));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_STEPS) : 0;
}

/**
 * Baselines are recomputed once per week; the old one shifts into the `prev` fields so last week's
 * Handicap board can still be scored (PlayerSummary.rollBaseline).
 */
export function rollBaseline(current, previous, weekKey, fresh, replacing = false) {
  const kept = previous ?? { avg: 0, weekKey: "" };
  if (current && current.weekKey === weekKey) return { current: replacing ? { avg: fresh(), weekKey } : current, previous: kept };
  const shifted = current && current.weekKey !== "" ? current : kept;
  return { current: { avg: fresh(), weekKey }, previous: shifted };
}

/**
 * The Player summary a web runner publishes after entering steps: PlayerSummary.build with the runner's
 * own baseline (GuestEntry.ownBaseline: 0 until 14 days are logged in the baseline window).
 * `entries` is every day this page has for the runner, reaching back to the locked window; `totals`
 * (built from the same entries plus the day being entered) win where they overlap.
 * Self-reported runners never show "moved recently".
 */
export function buildSummary({ id, profile, crew, totals, entries = {}, previous, todayKey, now }) {
  const weekKey = weekKeyForDay(todayKey);
  const weekDays = new Set(weekDayKeys(todayKey));
  const goal = crew.dailyGoal ?? profile.dailyGoal ?? DAILY_GOAL_STANDARD;
  const streak = streaks(totals.map((t) => t.steps), goal);

  const current = previous ? { avg: previous.baselineDailyAvg, weekKey: previous.baselineWeekKey } : null;
  const prior = previous ? { avg: previous.prevBaselineDailyAvg, weekKey: previous.prevBaselineWeekKey } : null;
  const known = { ...entries, ...Object.fromEntries(totals.map((t) => [t.dayKey, t.steps])) };
  const own = selfReportedBaseline(known, crew, todayKey);
  const baseline = totals.length
    ? rollBaseline(current, prior, weekKey, () => own, true)
    : { current: current ?? { avg: BASELINE_FLOOR, weekKey: "" }, previous: prior ?? { avg: 0, weekKey: "" } };

  return {
    id,
    displayName: profile.displayName.slice(0, MAX_NAME_LENGTH),
    avatarEmoji: profile.avatarEmoji,
    dailyGoal: profile.dailyGoal ?? DAILY_GOAL_STANDARD,
    crewCode: crew.code,
    todayKey,
    todaySteps: totals.find((t) => t.dayKey === todayKey)?.steps ?? 0,
    weekKey,
    weekSteps: totals.filter((t) => weekDays.has(t.dayKey)).reduce((sum, t) => sum + t.steps, 0),
    weekDistanceM: 0,
    currentStreak: streak.current,
    bestStreak: Math.max(streak.best, previous?.bestStreak ?? 0),
    baselineDailyAvg: baseline.current.avg,
    baselineWeekKey: baseline.current.weekKey,
    prevBaselineDailyAvg: baseline.previous.avg,
    prevBaselineWeekKey: baseline.previous.weekKey,
    lastActiveAt: null,
    lastSyncedAt: now,
    badgeIDs: previous?.badgeIDs ?? [],
    selfReported: true,
  };
}

/** The baseline that applied during `weekKey`, or null when neither stored baseline covers it. */
export function baselineForWeek(player, weekKey) {
  if (player.baselineWeekKey === weekKey) return player.baselineDailyAvg;
  if (player.prevBaselineWeekKey === weekKey) return player.prevBaselineDailyAvg;
  return null;
}

// MARK: Boards (Scoring.swift Leaderboard, CompetitionWindow.swift CompetitionScoring)

/**
 * Standings for the board, exactly as the app ranks them:
 * - no window, warm-up: from Player summaries (stale summaries count as 0);
 * - live or finished: from DaySteps over the window's days, each day using its own week's baseline.
 * Either way the crew's handicap rule (strength and median, then the floor) turns baselines into targets.
 * `metric` is "week" or "overall"; `mode` is "handicap" or "raw".
 */
export function standings({ players, daySteps, crew, todayKey, metric, mode }) {
  const rule = handicapRule(crew, players);
  const window = competitionWindow(crew);
  const ph = phase(window, todayKey);
  const inputs = {};

  if (!window || ph === "warmUp") {
    const weekKey = weekKeyForDay(todayKey);
    const days = daysElapsedInWeek(todayKey);
    for (const p of players) {
      const steps = p.weekKey === weekKey ? p.weekSteps : 0;
      inputs[p.id] = { steps, expected: effectiveBaseline(rule, p.baselineDailyAvg) * days };
    }
  } else {
    const keys = metric === "overall"
      ? windowDayKeys(window, todayKey)
      : weekDayKeys(todayKey).filter((k) => k >= window.start && k <= window.end && k <= todayKey);
    const wanted = new Set(keys);
    const byPlayer = {};
    for (const d of daySteps) {
      if (!wanted.has(d.dayKey)) continue;
      (byPlayer[d.playerID] ??= {})[d.dayKey] = d;
    }
    for (const p of players) {
      const days = byPlayer[p.id] ?? {};
      let steps = 0;
      let expected = 0;
      for (const key of keys) {
        const record = days[key];
        steps += record?.steps ?? 0;
        const stamped = record?.baselineDailyAvg > 0 ? record.baselineDailyAvg : null;
        const raw = stamped ?? baselineForWeek(p, weekKeyForDay(key)) ?? p.baselineDailyAvg;
        expected += effectiveBaseline(rule, raw);
      }
      inputs[p.id] = { steps, expected };
    }
  }
  return rank(players, inputs, mode);
}

/** Competition ranking: tied runners share a rank and the next rank skips (1, 1, 3). */
export function rank(players, inputs, mode) {
  const entries = players.map((player) => {
    const input = inputs[player.id] ?? { steps: 0, expected: BASELINE_FLOOR };
    return { player, steps: input.steps, expected: Math.max(input.expected, BASELINE_FLOOR) };
  });
  // Handicap compares exactly by cross-multiplying, never through rounded percentages.
  const compare = (a, b) =>
    mode === "raw" ? b.steps - a.steps : b.steps * a.expected - a.steps * b.expected;
  const sorted = [...entries].sort((a, b) => compare(a, b) || a.player.displayName.localeCompare(b.player.displayName));

  const result = [];
  sorted.forEach((entry, i) => {
    const tiedPrev = i > 0 && compare(sorted[i - 1], entry) === 0;
    const tiedNext = i + 1 < sorted.length && compare(entry, sorted[i + 1]) === 0;
    result.push({
      player: entry.player,
      rank: tiedPrev ? result[i - 1].rank : i + 1,
      isTied: tiedPrev || tiedNext,
      steps: entry.steps,
      expected: mode === "raw" ? null : entry.expected,
      percent: mode === "raw" ? null : Math.round((entry.steps / entry.expected) * 100),
    });
  });
  return result;
}

/**
 * The days a web runner may enter: the last 35 days, never past the finish. Days before the start
 * don't score, but they count toward the 14 logged days a runner needs for a baseline of their own,
 * the same as a guest's entries in the app.
 */
export function enterableDayKeys(crew, todayKey) {
  const window = competitionWindow(crew);
  const days = dayKeysEndingOn(todayKey, HISTORY_DAYS).reverse();
  return window ? days.filter((k) => k <= window.end) : days;
}
