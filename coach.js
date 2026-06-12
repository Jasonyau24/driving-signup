import { todayDate, normalizeSlot, requestJson } from "./shared.js";

const statusText = document.querySelector("#statusText");
const loginPanel = document.querySelector("#loginPanel");
const coachPanel = document.querySelector("#coachPanel");
const pinForm = document.querySelector("#pinForm");
const coachPin = document.querySelector("#coachPin");
const coachForm = document.querySelector("#coachForm");
const addSlot = document.querySelector("#addSlot");
const slotEditor = document.querySelector("#slotEditor");
const editorTemplate = document.querySelector("#editorRowTemplate");
let publishDatePicker = document.querySelector("#publishDatePicker");

if (!publishDatePicker) {
  const dateBadge = document.querySelector(".date-badge");
  const fallbackDateText = document.querySelector("#activeDateText");
  publishDatePicker = document.createElement("input");
  publishDatePicker.id = "publishDatePicker";
  publishDatePicker.type = "date";

  if (dateBadge) {
    dateBadge.classList.add("date-picker-badge");
    dateBadge.replaceChildren();
    const label = document.createElement("span");
    label.textContent = "发布日期";
    dateBadge.append(label, publishDatePicker);
  } else if (fallbackDateText) {
    fallbackDateText.replaceWith(publishDatePicker);
  }
}

let selectedDate = todayDate();
let schedule = { date: selectedDate, slots: [] };
let activePin = sessionStorage.getItem("coachPin") || "";

const defaultSlots = [
  "08:00-09:00",
  "09:00-10:00",
  "10:00-11:00",
  "11:00-12:00",
  "12:00-13:00",
  "13:00-14:00",
  "14:00-15:00",
  "15:00-16:00",
  "16:00-17:00",
  "17:00-18:00",
  "18:00-19:00",
  "19:00-20:00"
];

publishDatePicker.min = todayDate();
publishDatePicker.value = selectedDate;
coachPin.value = activePin;

function setStatus(message, tone = "normal") {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

function showLogin(message = "请输入教练 PIN") {
  activePin = "";
  sessionStorage.removeItem("coachPin");
  loginPanel.classList.remove("hidden");
  coachPanel.classList.add("hidden");
  setStatus(message);
}

async function unlockCoach(pin) {
  const cleanPin = pin.trim();
  if (!cleanPin) {
    setStatus("请输入教练 PIN", "error");
    return;
  }

  setStatus("正在校验 PIN...");
  await requestJson("/.netlify/functions/schedule", {
    method: "POST",
    headers: { "X-Coach-Pin": cleanPin },
    body: JSON.stringify({ action: "verifyCoach" })
  });

  activePin = cleanPin;
  sessionStorage.setItem("coachPin", activePin);
  loginPanel.classList.add("hidden");
  coachPanel.classList.remove("hidden");
  await loadSchedule();
}

async function loadSchedule() {
  selectedDate = publishDatePicker.value || todayDate();
  publishDatePicker.value = selectedDate;
  setStatus("正在读取时间表...");
  try {
    const data = await requestJson(`/.netlify/functions/schedule?date=${encodeURIComponent(selectedDate)}`, {
      headers: { "X-Coach-Pin": activePin }
    });
    schedule = {
      date: data.date,
      slots: Array.isArray(data.slots) ? data.slots.map(normalizeSlot) : []
    };
    renderEditor();
    setStatus(data.updatedAt ? `已更新：${new Date(data.updatedAt).toLocaleString()}` : "所选日期还没有发布时间表");
  } catch (error) {
    schedule = { date: selectedDate, slots: [] };
    renderEditor();
    setStatus(error.message, "error");
  }
}

function renderEditor() {
  slotEditor.replaceChildren();
  const sourceSlots = schedule.slots.length
    ? schedule.slots
    : defaultSlots.map((time) => ({ time, available: false, name: "", note: "" }));

  for (const slot of sourceSlots) {
    addEditorRow(slot);
  }
}

function addEditorRow(slot = { time: "", available: true, name: "", note: "" }) {
  const fragment = editorTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".editor-row");
  const time = fragment.querySelector(".editor-time");
  const available = fragment.querySelector(".editor-available");
  const note = fragment.querySelector(".editor-note");
  const remove = fragment.querySelector(".danger-button");

  time.value = slot.time || "";
  available.checked = Boolean(slot.available);
  note.value = slot.note || "";
  remove.addEventListener("click", () => row.remove());

  slotEditor.append(fragment);
}

function collectEditorSlots() {
  const rows = [...slotEditor.querySelectorAll(".editor-row")];
  const slots = rows.map((row) => ({
    time: row.querySelector(".editor-time").value.trim(),
    available: row.querySelector(".editor-available").checked,
    note: row.querySelector(".editor-note").value.trim()
  })).filter((slot) => slot.time);

  const seen = new Set();
  for (const slot of slots) {
    if (seen.has(slot.time)) {
      throw new Error(`重复时段：${slot.time}`);
    }
    seen.add(slot.time);
  }
  return slots;
}

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = pinForm.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await unlockCoach(coachPin.value);
  } catch (error) {
    showLogin(error.message);
    statusText.dataset.tone = "error";
  } finally {
    submit.disabled = false;
  }
});

coachForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let slots;
  try {
    slots = collectEditorSlots();
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  const submit = coachForm.querySelector("button[type='submit']");
  submit.disabled = true;
  selectedDate = publishDatePicker.value || todayDate();
  setStatus("正在发布...");
  try {
    const data = await requestJson("/.netlify/functions/schedule", {
      method: "POST",
      headers: { "X-Coach-Pin": activePin },
      body: JSON.stringify({ action: "saveSchedule", date: selectedDate, slots })
    });
    schedule = { date: data.date, slots: data.slots.map(normalizeSlot) };
    renderEditor();
    setStatus("时间表已发布");
  } catch (error) {
    if (error.message.includes("PIN")) {
      showLogin(error.message);
      statusText.dataset.tone = "error";
    } else {
      setStatus(error.message, "error");
    }
  } finally {
    submit.disabled = false;
  }
});

publishDatePicker.addEventListener("change", () => {
  if (activePin) {
    loadSchedule();
  }
});

addSlot.addEventListener("click", () => addEditorRow());

if (activePin) {
  unlockCoach(activePin).catch((error) => {
    showLogin(error.message);
    statusText.dataset.tone = "error";
  });
} else {
  showLogin();
}
