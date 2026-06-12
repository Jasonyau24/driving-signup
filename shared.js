export function activeSignupDate(now = new Date()) {
  const value = new Date(now);
  value.setDate(value.getDate() + 1);
  return toDateInputValue(value);
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
      throw new Error("找不到后台函数，请用 Git/Netlify 构建发布，不要只拖拽静态文件");
    }
    throw new Error(`服务器请求失败（${response.status}）`);
  }

  return payload;
}
