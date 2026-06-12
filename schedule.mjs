import { connectLambda, getStore } from "@netlify/blobs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const timePattern = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;
const timeZone = process.env.APP_TIME_ZONE || "Asia/Taipei";
const rolloverHour = Number(process.env.ROLLOVER_HOUR || 21);

function response(statusCode, payload) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function localDateParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
}

function addDays(dateValue, days) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  const parts = localDateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function activeSignupDate() {
  const parts = localDateParts();
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) >= rolloverHour ? addDays(today, 1) : today;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error("Date format is invalid.");
  }
  return value;
}

function requireStudentDate(date) {
  const today = todayDate();
  const activeDate = activeSignupDate();
  if (date !== today && date !== activeDate) {
    throw new Error(`Students can only use ${activeDate.replaceAll("-", "/")}.`);
  }
}

function requireCoachDate(date) {
  const today = todayDate();
  if (date < today) {
    throw new Error(`Coach can only manage ${today.replaceAll("-", "/")} or later.`);
  }
}

function scheduleKey(date) {
  return `schedule-${date}`;
}

function normalizeSlot(slot, existingByTime = new Map()) {
  const time = cleanText(slot.time, 24);
  if (!timePattern.test(time)) {
    throw new Error(`Invalid time slot: ${time || "blank"}`);
  }

  const available = Boolean(slot.available);
  const previous = existingByTime.get(time);
  return {
    time,
    available,
    note: cleanText(slot.note, 30),
    name: available ? cleanText(previous?.name, 20) : ""
  };
}

function sortSlots(slots) {
  return slots.sort((a, b) => a.time.localeCompare(b.time, "zh-Hans", { numeric: true }));
}

function requireCoachPin(event) {
  const configuredPin = process.env.COACH_PIN;
  if (!configuredPin) {
    throw new Error("COACH_PIN is not set in Netlify environment variables.");
  }

  const suppliedPin = event.headers["x-coach-pin"] || event.headers["X-Coach-Pin"];
  if (suppliedPin !== configuredPin) {
    throw new Error("Coach PIN is incorrect.");
  }
}

async function readSchedule(store, date) {
  const saved = await store.get(scheduleKey(date), { type: "json" });
  if (saved?.date === date && Array.isArray(saved.slots)) {
    return saved;
  }
  return { date, activeDate: activeSignupDate(), updatedAt: "", slots: [] };
}

async function writeSchedule(store, schedule) {
  const next = { ...schedule, activeDate: activeSignupDate(), updatedAt: new Date().toISOString() };
  await store.setJSON(scheduleKey(schedule.date), next);
  return next;
}

async function saveCoachSchedule(event, store, body) {
  requireCoachPin(event);
  const date = validateDate(body.date);
  requireCoachDate(date);
  if (!Array.isArray(body.slots)) {
    throw new Error("Missing slot list.");
  }

  const current = await readSchedule(store, date);
  const existingByTime = new Map(current.slots.map((slot) => [slot.time, slot]));
  const seen = new Set();
  const slots = body.slots.map((slot) => normalizeSlot(slot, existingByTime));

  for (const slot of slots) {
    if (seen.has(slot.time)) {
      throw new Error(`Duplicate time slot: ${slot.time}`);
    }
    seen.add(slot.time);
  }

  const next = await writeSchedule(store, { date, slots: sortSlots(slots) });
  return response(200, next);
}

async function signup(store, body) {
  const date = validateDate(body.date);
  requireStudentDate(date);
  const time = cleanText(body.time, 24);
  const name = cleanText(body.name, 20);

  if (!name) {
    throw new Error("Please enter your name.");
  }

  const current = await readSchedule(store, date);
  const slot = current.slots.find((item) => item.time === time);
  if (!slot) {
    throw new Error("This time slot does not exist.");
  }
  if (!slot.available) {
    throw new Error("The coach is unavailable for this time slot.");
  }
  if (slot.name) {
    throw new Error("This time slot has already been booked.");
  }

  slot.name = name;
  const next = await writeSchedule(store, current);
  return response(200, next);
}

async function cancelSignup(store, body) {
  const date = validateDate(body.date);
  requireStudentDate(date);
  const time = cleanText(body.time, 24);
  const name = cleanText(body.name, 20);

  if (!name) {
    throw new Error("Enter the same name used for booking.");
  }

  const current = await readSchedule(store, date);
  const slot = current.slots.find((item) => item.time === time);
  if (!slot || !slot.name) {
    throw new Error("No booking exists for this time slot.");
  }
  if (slot.name !== name) {
    throw new Error("Name does not match this booking.");
  }

  slot.name = "";
  const next = await writeSchedule(store, current);
  return response(200, next);
}

export async function handler(event) {
  try {
    if (event.blobs) {
      connectLambda(event);
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (body.action === "verifyCoach") {
        requireCoachPin(event);
        return response(200, { ok: true, activeDate: activeSignupDate(), today: todayDate() });
      }
    }

    const store = getStore("driving-practice-signups");

    if (event.httpMethod === "GET") {
      const date = validateDate(event.queryStringParameters?.date);
      const hasCoachPin = Boolean(event.headers["x-coach-pin"] || event.headers["X-Coach-Pin"]);
      if (hasCoachPin) {
        requireCoachPin(event);
        requireCoachDate(date);
      }
      const schedule = await readSchedule(store, date);
      return response(200, schedule);
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (body.action === "saveSchedule") {
        return await saveCoachSchedule(event, store, body);
      }
      if (body.action === "signup") {
        return await signup(store, body);
      }
      if (body.action === "cancelSignup") {
        return await cancelSignup(store, body);
      }
      throw new Error("Unknown action.");
    }

    return response(405, { error: "Method is not supported." });
  } catch (error) {
    if (String(error.message || "").includes("Netlify Blobs")) {
      return response(500, {
        error: "Netlify Blobs is not connected. Redeploy with Netlify build instead of static drag-and-drop."
      });
    }
    return response(400, { error: error.message || "Request failed." });
  }
}
