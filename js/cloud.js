// The CloudKit JS side: the same record types, record names and fields the iPhone app uses
// (Jimothy/Services/CloudCrewStore.swift). Every record a web runner writes is created by their
// own iCloud account, so only they can change it.

import { CONFIG, resolvedEnvironment } from "./config.js";

const T = { player: "Player", crew: "Crew", membership: "Membership", daySteps: "DaySteps" };

let database = null;
let container = null;

/** Configures CloudKit and returns the signed-in user's record name, or null when signed out. */
export async function setUp({ onSignIn, onSignOut }) {
  const environment = resolvedEnvironment();
  const apiToken = CONFIG.apiTokens[environment];
  if (!apiToken) throw new Error(`No CloudKit API token for ${environment}. See web/README.md.`);
  CloudKit.configure({
    containers: [{
      containerIdentifier: CONFIG.containerIdentifier,
      apiTokenAuth: {
        apiToken,
        persist: true,
        signInButton: { id: "apple-sign-in-button", theme: "black" },
        signOutButton: { id: "apple-sign-out-button", theme: "white-with-outline" },
      },
      environment,
    }],
  });
  container = CloudKit.getDefaultContainer();
  database = container.publicCloudDatabase;

  const watchSignIn = () => container.whenUserSignsIn().then((identity) => {
    onSignIn(identity.userRecordName);
    watchSignOut();
  });
  const watchSignOut = () => container.whenUserSignsOut().then(() => {
    onSignOut();
    watchSignIn();
  });

  const identity = await container.setUpAuth();
  if (identity) {
    watchSignOut();
    return identity.userRecordName;
  }
  watchSignIn();
  return null;
}

export function environmentName() {
  return resolvedEnvironment();
}

// MARK: Field mapping

const value = (record, key, fallback = null) => record.fields?.[key]?.value ?? fallback;

function toPlayer(record) {
  if (!record?.fields?.displayName) return null;
  return {
    id: record.recordName,
    changeTag: record.recordChangeTag,
    displayName: value(record, "displayName", ""),
    avatarEmoji: value(record, "avatarEmoji", ""),
    dailyGoal: value(record, "dailyGoal", 0) || 8000,
    crewCode: value(record, "crewCode", ""),
    todayKey: value(record, "todayKey", ""),
    todaySteps: value(record, "todaySteps", 0),
    weekKey: value(record, "weekKey", ""),
    weekSteps: value(record, "weekSteps", 0),
    weekDistanceM: value(record, "weekDistanceM", 0),
    currentStreak: value(record, "currentStreak", 0),
    bestStreak: value(record, "bestStreak", 0),
    baselineDailyAvg: value(record, "baselineDailyAvg", 0),
    baselineWeekKey: value(record, "baselineWeekKey", ""),
    prevBaselineDailyAvg: value(record, "prevBaselineDailyAvg", 0),
    prevBaselineWeekKey: value(record, "prevBaselineWeekKey", ""),
    lastActiveAt: value(record, "lastActiveAt"),
    badgeIDs: value(record, "badgeIDs", []),
    selfReported: value(record, "selfReported", 0) !== 0,
  };
}

function toCrew(record) {
  if (!record?.fields?.name) return null;
  return {
    code: record.recordName,
    name: value(record, "name", ""),
    timeZoneID: value(record, "timeZoneID", Intl.DateTimeFormat().resolvedOptions().timeZone),
    createdBy: value(record, "createdBy", ""),
    startDayKey: value(record, "startDayKey"),
    endDayKey: value(record, "endDayKey"),
    dailyGoal: value(record, "dailyGoal"),
  };
}

function toDaySteps(record) {
  return {
    playerID: value(record, "playerID", ""),
    crewCode: value(record, "crewCode", ""),
    dayKey: value(record, "dayKey", ""),
    steps: value(record, "steps", 0),
    baselineDailyAvg: value(record, "baselineDailyAvg"),
  };
}

function playerFields(p) {
  const fields = {
    displayName: { value: p.displayName },
    avatarEmoji: { value: p.avatarEmoji },
    dailyGoal: { value: p.dailyGoal },
    crewCode: { value: p.crewCode },
    todayKey: { value: p.todayKey },
    todaySteps: { value: p.todaySteps },
    weekKey: { value: p.weekKey },
    weekSteps: { value: p.weekSteps },
    weekDistanceM: { value: p.weekDistanceM },
    currentStreak: { value: p.currentStreak },
    bestStreak: { value: p.bestStreak },
    baselineDailyAvg: { value: p.baselineDailyAvg },
    baselineWeekKey: { value: p.baselineWeekKey },
    prevBaselineDailyAvg: { value: p.prevBaselineDailyAvg },
    prevBaselineWeekKey: { value: p.prevBaselineWeekKey },
    lastSyncedAt: { value: p.lastSyncedAt },
    // Needs Player.selfReported in the environment's schema (Production: deploy first).
    selfReported: { value: 1 },
  };
  if (p.badgeIDs?.length) fields.badgeIDs = { value: p.badgeIDs };
  return fields;
}

// MARK: Reads

async function fetchOne(recordName) {
  const response = await database.fetchRecords([recordName]);
  const record = response.records?.[0];
  if (!record || record.serverErrorCode === "NOT_FOUND") return null;
  if (response.hasErrors || record.serverErrorCode) throw cloudError(response.errors?.[0] ?? record);
  return record;
}

async function query(recordType, filterBy) {
  let response = await database.performQuery({ recordType, filterBy }, { resultsLimit: 200 });
  if (response.hasErrors) throw cloudError(response.errors[0]);
  const records = [...response.records];
  while (response.moreComing) {
    response = await database.performQuery(response);
    if (response.hasErrors) throw cloudError(response.errors[0]);
    records.push(...response.records);
  }
  return records;
}

const equals = (fieldName, v) => ({ fieldName, comparator: "EQUALS", fieldValue: { value: v } });
const within = (fieldName, list) => ({ fieldName, comparator: "IN", fieldValue: { value: list, type: "STRING_LIST" } });

export async function fetchPlayer(id) {
  return toPlayer(await fetchOne(id));
}

export async function fetchCrew(code) {
  return toCrew(await fetchOne(code));
}

export async function isMember(code, playerID) {
  return (await fetchOne(membershipName(code, playerID))) !== null;
}

export async function crewPlayers(code) {
  const memberships = await query(T.membership, [equals("crewCode", code)]);
  const ids = memberships.map((r) => value(r, "playerID")).filter(Boolean);
  if (!ids.length) return [];
  const response = await database.fetchRecords(ids);
  return (response.records ?? []).filter((r) => !r.serverErrorCode).map(toPlayer).filter(Boolean);
}

export async function crewDaySteps(code, dayKeys) {
  if (!dayKeys.length) return [];
  return (await query(T.daySteps, [equals("crewCode", code), within("dayKey", dayKeys)])).map(toDaySteps);
}

// MARK: Writes

function membershipName(code, playerID) {
  return `${code}_${playerID}`;
}

/** Creates or updates records, fetching change tags first so an update never duplicates. */
async function save(records) {
  const existing = await database.fetchRecords(records.map((r) => r.recordName));
  const tags = Object.fromEntries((existing.records ?? []).filter((r) => !r.serverErrorCode).map((r) => [r.recordName, r.recordChangeTag]));
  const toSave = records.map((r) => (tags[r.recordName] ? { ...r, recordChangeTag: tags[r.recordName] } : r));
  const response = await database.saveRecords(toSave);
  if (response.hasErrors) throw cloudError(response.errors[0]);
}

export async function savePlayer(player) {
  await save([{ recordType: T.player, recordName: player.id, fields: playerFields(player) }]);
}

export async function joinCrew(code, playerID) {
  await save([{
    recordType: T.membership,
    recordName: membershipName(code, playerID),
    fields: { crewCode: { value: code }, playerID: { value: playerID }, joinedAt: { value: Date.now() } },
  }]);
}

export async function saveDaySteps({ playerID, crewCode, dayKey, steps, baselineDailyAvg }) {
  const fields = {
    playerID: { value: playerID },
    crewCode: { value: crewCode },
    dayKey: { value: dayKey },
    steps: { value: steps },
    distanceM: { value: 0 },
    flights: { value: 0 },
  };
  if (baselineDailyAvg != null) fields.baselineDailyAvg = { value: baselineDailyAvg };
  await save([{ recordType: T.daySteps, recordName: `${playerID}_${dayKey}`, fields }]);
}

function cloudError(error) {
  const e = new Error(error?.reason ?? error?.serverErrorCode ?? "CloudKit error");
  e.code = error?.serverErrorCode ?? error?.ckErrorCode;
  return e;
}
