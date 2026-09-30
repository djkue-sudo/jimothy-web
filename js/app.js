// Jimothy on the web: sign in with an Apple ID, join the crew, type in your steps, see the board.

import * as D from "./domain.js";

// `?mock` on localhost swaps in an in-memory crew for checking the page without an Apple sign-in.
const useMock = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("mock");
const Cloud = useMock ? await import("./mock-cloud.js") : await import("./cloud.js");

const $ = (id) => document.getElementById(id);
const screens = ["loading", "signin", "setup", "home", "problem"];

const state = {
  myID: null,
  me: null,
  crew: null,
  players: [],
  daySteps: [],
  metric: "week",
  mode: "handicap",
  editingProfile: false,
  emoji: D.RUNNER_EMOJI[1],
};

function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  window.scrollTo(0, 0);
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmt = (n) => Number(n).toLocaleString();

/** The app's "Self-reported" symbol (square.and.pencil), drawn inline so it matches the text colour. */
const PENCIL = `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h6M2.5 3.5v10h10v-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12.6 1.9l1.5 1.5-6 6-2.1.6.6-2.1z" fill="currentColor"/></svg>`;

function todayKey() {
  return D.dayKey(new Date(), state.crew?.timeZoneID ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** "Mon, Oct 5" for a day key (a calendar date, so formatted in UTC). */
function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function problem(title, message) {
  $("problem-title").textContent = title;
  $("problem-message").textContent = message;
  show("problem");
}

// MARK: Boot and auth

async function boot() {
  show("loading");
  try {
    const user = await Cloud.setUp({ onSignIn: signedIn, onSignOut: signedOut });
    if (user) await signedIn(user);
    else show("signin");
  } catch (error) {
    console.error(error);
    problem("Jimothy can't reach iCloud", error.message.includes("API token")
      ? error.message
      : "Check your connection and try again.");
  }
  const env = Cloud.environmentName();
  if (env !== "production") {
    $("env").hidden = false;
    $("env").textContent = `Test mode (${env}). Nothing here reaches the real crew.`;
  }
}

async function signedIn(userRecordName) {
  show("loading");
  state.myID = "p_" + userRecordName;
  try {
    state.me = await Cloud.fetchPlayer(state.myID);
    const code = state.me?.crewCode;
    if (code && (await Cloud.isMember(code, state.myID))) {
      state.crew = await Cloud.fetchCrew(code);
      if (state.crew) return loadHome();
    }
    openSetup(false);
  } catch (error) {
    console.error(error);
    problem("Jimothy can't reach iCloud", "Check your connection and try again.");
  }
}

function signedOut() {
  Object.assign(state, { myID: null, me: null, crew: null, players: [], daySteps: [] });
  show("signin");
}

// MARK: Setup and profile

function openSetup(editing) {
  state.editingProfile = editing;
  $("name").value = state.me?.displayName ?? "";
  state.emoji = state.me?.avatarEmoji || D.RUNNER_EMOJI[1];
  $("code").closest(".field").hidden = editing;
  $("join").textContent = editing ? "Save" : "Join the crew";
  document.querySelector("#setup h1").textContent = editing ? "Your runner" : "Get on the board";
  $("setup-error").hidden = true;
  renderEmojiGrid();
  show("setup");
}

function renderEmojiGrid() {
  $("emoji-grid").innerHTML = D.RUNNER_EMOJI.map((e) =>
    `<button type="button" role="radio" aria-checked="${e === state.emoji}" aria-label="${e}" data-emoji="${e}">${e}</button>`
  ).join("");
}

$("emoji-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-emoji]");
  if (!button) return;
  state.emoji = button.dataset.emoji;
  renderEmojiGrid();
});

$("code").addEventListener("input", () => {
  $("code").value = D.sanitizeCrewCode($("code").value);
});

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("setup-error");
  const name = $("name").value.trim().slice(0, D.MAX_NAME_LENGTH);
  const code = D.sanitizeCrewCode($("code").value);
  const say = (text) => { error.textContent = text; error.hidden = false; };
  if (!name) return say("Jimothy needs something to call you.");
  if (!state.editingProfile && !D.isValidCrewCode(code)) return say("Crew codes are six letters and numbers, like K7Q2MX.");

  $("join").disabled = true;
  try {
    if (state.editingProfile) {
      await publish({ profile: { displayName: name, avatarEmoji: state.emoji } });
      return loadHome();
    }
    const crew = await Cloud.fetchCrew(code);
    if (!crew) return say(`Jimothy can't find crew ${code}. Check the code with whoever invited you.`);
    state.crew = crew;
    await loadCrew();
    await publish({ profile: { displayName: name, avatarEmoji: state.emoji } });
    await Cloud.joinCrew(crew.code, state.myID);
    await loadHome();
  } catch (e) {
    console.error(e);
    say("Jimothy couldn't save that. Check your connection and try again.");
  } finally {
    $("join").disabled = false;
  }
});

$("edit-profile").addEventListener("click", () => openSetup(true));

// MARK: Loading the crew

/** This week and last, the competition so far, and your last 35 days: everything the page shows. */
function dayKeysToLoad() {
  const today = todayKey();
  const keys = new Set([
    ...D.weekDayKeys(D.addDays(today, -7)),
    ...D.weekDayKeys(today),
    ...D.dayKeysEndingOn(today, D.HISTORY_DAYS),
  ]);
  const window = D.competitionWindow(state.crew);
  if (window) {
    for (const k of D.windowDayKeys(window, today)) keys.add(k);
    // The locked baseline's 28 days, which fall out of the 35-day history late in a competition.
    for (const k of D.lockDayKeys(window.start)) keys.add(k);
  }
  return [...keys];
}

async function loadCrew() {
  const [players, daySteps] = await Promise.all([
    Cloud.crewPlayers(state.crew.code),
    Cloud.crewDaySteps(state.crew.code, dayKeysToLoad()),
  ]);
  state.players = players;
  state.daySteps = daySteps;
  state.me = players.find((p) => p.id === state.myID) ?? state.me;
}

async function loadHome() {
  show("loading");
  try {
    await loadCrew();
    renderHome();
    show("home");
    // Mock only (localhost): `&explain` opens How Handicap works, for checking the dialog headlessly.
    if (useMock && new URLSearchParams(location.search).has("explain")) $("handicap-info").click();
  } catch (error) {
    console.error(error);
    problem("Jimothy can't reach iCloud", "Check your connection and try again.");
  }
}

// MARK: Publishing

const myDays = () => state.daySteps.filter((d) => d.playerID === state.myID);

/**
 * Republishes your Player summary (and one day's steps, when entering), exactly as the app does for a
 * guest: 35 days of history, streaks, and your own baseline once 14 days are logged in its window.
 */
async function publish({ profile, entering }) {
  const today = todayKey();
  const previous = state.me;
  const totals = D.historyTotals(myDays(), entering?.steps, entering?.dayKey ?? null, today);
  const summary = D.buildSummary({
    id: state.myID,
    profile: {
      displayName: profile?.displayName ?? previous.displayName,
      avatarEmoji: profile?.avatarEmoji ?? previous.avatarEmoji,
      dailyGoal: state.crew.dailyGoal ?? previous?.dailyGoal ?? D.DAILY_GOAL_STANDARD,
    },
    crew: state.crew,
    totals,
    entries: Object.fromEntries(myDays().map((d) => [d.dayKey, d.steps])),
    previous,
    todayKey: today,
    now: Date.now(),
  });
  if (entering) {
    const steps = totals.find((t) => t.dayKey === entering.dayKey)?.steps ?? 0;
    await Cloud.saveDaySteps({
      playerID: state.myID,
      crewCode: state.crew.code,
      dayKey: entering.dayKey,
      steps,
      baselineDailyAvg: D.baselineForWeek(summary, D.weekKeyForDay(entering.dayKey)),
    });
  }
  await Cloud.savePlayer(summary);
  state.me = summary;
}

async function enter(dayKey, raw, button) {
  if (String(raw).trim() === "") return;
  button.disabled = true;
  try {
    await publish({ entering: { dayKey, steps: D.clampSteps(raw) } });
    await loadCrew();
    renderHome();
  } catch (error) {
    console.error(error);
    alertInline(button, "Jimothy couldn't save that. Check your connection and try again.");
  } finally {
    button.disabled = false;
  }
}

function alertInline(near, text) {
  let note = near.parentElement.querySelector(".problem");
  if (!note) {
    note = document.createElement("p");
    note.className = "problem";
    note.setAttribute("role", "alert");
    near.parentElement.after(note);
  }
  note.textContent = text;
}

// MARK: Home

function renderHome() {
  const today = todayKey();
  const crew = state.crew;
  const window = D.competitionWindow(crew);
  const ph = D.phase(window, today);
  const goal = crew.dailyGoal ?? state.me?.dailyGoal ?? D.DAILY_GOAL_STANDARD;
  const enterable = D.enterableDayKeys(crew, today);
  const stepsOn = Object.fromEntries(myDays().map((d) => [d.dayKey, d.steps]));

  $("crew-name").textContent = crew.name;
  $("edit-profile").textContent = state.me?.avatarEmoji ?? "🦝";
  $("phase-title").textContent = ph === "finished" ? "Finish line" : "Today";

  const note = $("phase-note");
  if (ph === "warmUp") {
    note.hidden = false;
    note.textContent = `Warm-up. The competition starts ${dayLabel(window.start)}; step entry opens then.`;
  } else if (ph === "finished") {
    note.hidden = false;
    note.textContent = "Final results are in. Thanks for walking.";
  } else {
    note.hidden = true;
  }

  // Today
  const canEnterToday = enterable.includes(today);
  const todaySteps = stepsOn[today] ?? 0;
  $("today-card").hidden = !canEnterToday;
  $("today-steps").textContent = fmt(todaySteps);
  $("today-label").textContent = "steps today";
  $("today-fraction").textContent = `${fmt(todaySteps)} / ${fmt(goal)}`;
  $("today-togo").textContent = todaySteps >= goal ? "Goal done" : `${fmt(goal - todaySteps)} to go`;
  $("today-bar").querySelector("span").style.width = `${Math.min(todaySteps / goal, 1) * 100}%`;
  $("today-input").value = "";

  // Your days (not today): the last week up front, the rest folded away.
  const past = enterable.filter((k) => k !== today);
  const recent = past.slice(0, 6);
  const earlier = past.slice(6);
  $("days-title").hidden = past.length === 0;
  $("earlier").hidden = earlier.length === 0;
  $("earlier-label").textContent = `Earlier days (${earlier.length})`;
  const row = (key) => `
    <li>
      <span class="day">${dayLabel(key)}</span>
      <span class="value">${key in stepsOn ? fmt(stepsOn[key]) : "—"}</span>
      <form class="entry" data-day="${key}">
        <label class="sr-only" for="d-${key}">Steps on ${dayLabel(key)}</label>
        <input id="d-${key}" inputmode="numeric" pattern="[0-9]*" placeholder="${key in stepsOn ? "Change" : "Add"}" autocomplete="off">
        <button class="print-button small" type="submit">Save</button>
      </form>
    </li>`;
  $("days").innerHTML = recent.map(row).join("");
  $("days-earlier").innerHTML = earlier.map(row).join("");

  renderBoard(today, window, ph);
}

$("today-form").addEventListener("submit", (event) => {
  event.preventDefault();
  enter(todayKey(), $("today-input").value, event.submitter ?? event.target.querySelector("button"));
});

for (const list of ["days", "days-earlier"]) {
  $(list).addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target.closest("form[data-day]");
    enter(form.dataset.day, form.querySelector("input").value, form.querySelector("button"));
  });
}

// MARK: Board

function renderBoard(today, window, ph) {
  const metrics = ph === "finished" ? [["overall", "Final"]] : ph === "live" ? [["week", "This week"], ["overall", "Overall"]] : [["week", "This week"]];
  if (!metrics.some(([m]) => m === state.metric)) state.metric = metrics[0][0];
  $("metric").innerHTML = metrics.map(([m, label]) =>
    `<button role="tab" data-metric="${m}" aria-selected="${m === state.metric}">${label}</button>`).join("");
  for (const b of $("mode").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.mode === state.mode));

  const board = D.standings({ players: state.players, daySteps: state.daySteps, crew: state.crew, todayKey: today, metric: state.metric, mode: state.mode });
  const lastRank = board.at(-1)?.rank;
  $("board").innerHTML = board.map((s) => {
    const isMe = s.player.id === state.myID;
    const selfReported = D.isSelfReported(s.player);
    const rank = (s.isTied ? "T" : "") + s.rank;
    const primary = s.percent != null ? `${s.percent}%` : fmt(s.steps);
    const secondary = s.percent != null ? `${fmt(s.steps)} steps` : "steps";
    const last = board.length > 1 && s.rank === lastRank;
    const spoken = `${isMe ? "You" : s.player.displayName}${selfReported ? ", self-reported" : ""}, ${fmt(s.steps)} steps` +
      `${s.percent != null ? `, ${s.percent} percent of usual` : ""}, ${s.isTied ? "tied for " : ""}rank ${s.rank}${last ? ", still on course" : ""}`;
    return `
      <li class="row${isMe ? " you" : ""}" aria-label="${escapeHTML(spoken)}">
        <span class="rank" aria-hidden="true">${rank}</span>
        <span class="who" aria-hidden="true">
          <span class="name"><span class="emoji">${escapeHTML(s.player.avatarEmoji || "🦝")}</span>${isMe ? "You" : escapeHTML(s.player.displayName)}</span>
          ${selfReported ? `<span class="marker">${PENCIL}Self-reported</span>` : ""}
          ${last ? `<span class="tag">Still on course</span>` : ""}
        </span>
        <span class="score" aria-hidden="true"><span class="big">${primary}</span><br><span class="small">${secondary}</span></span>
      </li>`;
  }).join("");
}

$("metric").addEventListener("click", (event) => {
  const b = event.target.closest("[data-metric]");
  if (!b) return;
  state.metric = b.dataset.metric;
  renderHome();
});

$("mode").addEventListener("click", (event) => {
  const b = event.target.closest("[data-mode]");
  if (!b) return;
  state.mode = b.dataset.mode;
  renderHome();
});

// How Handicap works, with your own normal and % on top.
$("handicap-info").addEventListener("click", () => {
  const today = todayKey();
  const yours = $("handicap-yours");
  const me = state.players.find((p) => p.id === state.myID) ?? state.me;
  if (me) {
    const rule = D.handicapRule(state.crew, state.players);
    const own = D.baselineForWeek(me, D.weekKeyForDay(today)) ?? me.baselineDailyAvg;
    const target = D.effectiveBaseline(rule, own);
    let line = D.ownBaseline(own) == null
      ? `Your normal: the crew's typical ${fmt(target)}/day`
      : `Your normal: ${fmt(own)}/day` + (target !== own ? ` · target ${fmt(target)} at ${D.HANDICAP_STRENGTHS[rule.strength]}` : "");
    const window = D.competitionWindow(state.crew);
    const finished = D.phase(window, today) === "finished";
    const board = D.standings({ players: state.players, daySteps: state.daySteps, crew: state.crew, todayKey: today, metric: finished ? "overall" : "week", mode: "handicap" });
    const mine = board.find((s) => s.player.id === state.myID);
    if (mine) line += ` · you're at ${mine.percent}% ${finished ? "overall" : "this week"}`;
    yours.textContent = line;
    yours.hidden = false;
  } else {
    yours.hidden = true;
  }
  $("handicap-dialog").showModal();
});

$("refresh").addEventListener("click", loadHome);
$("retry").addEventListener("click", () => location.reload());

// CloudKit JS loads with `defer`; modules run after deferred scripts, so it's ready here.
boot();
