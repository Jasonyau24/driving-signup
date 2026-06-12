import { connectLambda, getStore } from "@netlify/blobs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const timePattern = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;
const timeZone = process.env.APP_TIME_ZONE || "Asia/Taipei";

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

function localDateInTimeZone(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateValue, days) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function activeSignupDate() {
  return addDays(localDateInTimeZone(), 1);
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error("日期格式不正确");
  }
  return value;
}

function requireActiveDate(date) {
  const activeDate = activeSignupDate();
  if (date !== activeDate) {
    throw new Error(`当前只能操作 ${activeDate.replaceAll("-", "/")} 的时间表`);
  }
}

function scheduleKey(date) {
  return `schedule-${date}`;
}

function normalizeSlot(slot, existingByTime = new Map()) {
  const time = cleanText(slot.time, 24);
  if (!timePattern.test(time)) {
    throw new Error(`时段格式不正确：${time || "空白"}`);
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
    throw new Error("请先在 Netlify 环境变量中设置 COACH_PIN");
  }

  const suppliedPin = event.headers["x-coach-pin"] || event.headers["X-Coach-Pin"];
  if (suppliedPin !== configuredPin) {
    throw new Error("教练 PIN 不正确");
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
  requireActiveDate(date);
  if (!Array.isArray(body.slots)) {
    throw new Error("缺少时段列表");
  }

  const current = await readSchedule(store, date);
  const existingByTime = new Map(current.slots.map((slot) => [slot.time, slot]));
  const seen = new Set();
  const slots = body.slots.map((slot) => normalizeSlot(slot, existingByTime));

  for (const slot of slots) {
    if (seen.has(slot.time)) {
      throw new Error(`重复时段：${slot.time}`);
    }
    seen.add(slot.time);
  }

  const next = await writeSchedule(store, { date, slots: sortSlots(slots) });
  return response(200, next);
}

async function signup(store, body) {
  const date = validateDate(body.date);
  requireActiveDate(date);
  const time = cleanText(body.time, 24);
  const name = cleanText(body.name, 20);

  if (!name) {
    throw new Error("请填写姓名");
  }

  const current = await readSchedule(store, date);
  const slot = current.slots.find((item) => item.time === time);
  if (!slot) {
    throw new Error("这个时段不存在");
  }
  if (!slot.available) {
    throw new Error("这个时段教练没空");
  }
  if (slot.name) {
    throw new Error("这个时段已经有人报名");
  }

  slot.name = name;
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
        return response(200, { ok: true, activeDate: activeSignupDate() });
      }
    }

    const store = getStore("driving-practice-signups");

    if (event.httpMethod === "GET") {
      const date = validateDate(event.queryStringParameters?.date);
      requireActiveDate(date);
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
      throw new Error("未知操作");
    }

    return response(405, { error: "不支持的请求方式" });
  } catch (error) {
    if (String(error.message || "").includes("Netlify Blobs")) {
      return response(500, {
        error: "后台存储没有连接成功，请重新用 Netlify 构建部署，不要只拖拽静态文件发布"
      });
    }
    return response(400, { error: error.message || "请求失败" });
  }
}
