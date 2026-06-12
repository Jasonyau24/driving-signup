const rolloverHour = 21;
const appTimeZone = "Asia/Taipei";

export function activeSignupDate(now = new Date()) {
  const parts = localDateParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) >= rolloverHour ? addDays(today, 1) : today;
}

export function todayDate(now = new Date()) {
  const parts = localDateParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
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

export function toDateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function formatDate(value) {
  return value.replaceAll("-", "/");
}

export function normalizeSlot(slot) {
  return {
    time: String(slot.time || "").trim(),
    available: Boolean(slot.available),
    name: String(slot.name || "").trim(),
    note: String(slot.note || "").trim()
  };
}

export async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    throw new Error("无法连接服务器，请确认 Netlify Functions 已部署");
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (response.status === 404) {
      throw new Error("找不到后台函数，请确认 netlify/functions/schedule.mjs 已上传并重新部署");
    }
    throw new Error(`服务器请求失败（${response.status}）`);
  }

  return payload;
}
