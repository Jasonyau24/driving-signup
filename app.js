import { activeSignupDate, formatDate, normalizeSlot, requestJson } from "./shared.js";

const activeDateText = document.querySelector("#activeDateText");
const statusText = document.querySelector("#statusText");
const scheduleGrid = document.querySelector("#scheduleGrid");
const signupForm = document.querySelector("#signupForm");
const studentName = document.querySelector("#studentName");
const slotTemplate = document.querySelector("#slotCardTemplate");

const signupDate = activeSignupDate();
let schedule = { date: signupDate, slots: [] };
let selectedTime = "";

activeDateText.textContent = formatDate(signupDate);

function setStatus(message, tone = "normal") {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

async function loadSchedule() {
  selectedTime = "";
  setStatus("正在读取时间表...");
  try {
    const data = await requestJson(`/.netlify/functions/schedule?date=${encodeURIComponent(signupDate)}`);
    schedule = {
      date: data.date,
      slots: Array.isArray(data.slots) ? data.slots.map(normalizeSlot) : []
    };
    renderSchedule();
    setStatus(data.updatedAt ? `已更新：${new Date(data.updatedAt).toLocaleString()}` : "教练还没有发布可报名时段");
  } catch (error) {
    schedule = { date: signupDate, slots: [] };
    renderSchedule();
    setStatus(error.message, "error");
  }
}

function renderSchedule() {
  scheduleGrid.replaceChildren();

  if (!schedule.slots.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "教练还没有发布可报名时段。";
    scheduleGrid.append(empty);
    return;
  }

  for (const slot of schedule.slots) {
    const fragment = slotTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".slot-card");
    const time = fragment.querySelector(".slot-time");
    const name = fragment.querySelector(".slot-name");
    const button = fragment.querySelector(".select-button");

    const isTaken = Boolean(slot.name);
    const isBusy = !slot.available;

    card.classList.toggle("selected", selectedTime === slot.time);
    card.classList.toggle("taken", isTaken);
    card.classList.toggle("busy", isBusy);
    time.textContent = slot.time;
    name.textContent = isBusy ? (slot.note || "教练没空") : isTaken ? `已报名：${slot.name}` : (slot.note || "可报名");

    if (isBusy) {
      button.textContent = "不可选";
      button.disabled = true;
    } else if (isTaken) {
      button.textContent = "取消";
      button.disabled = false;
      button.classList.add("cancel-button");
      button.addEventListener("click", () => cancelSignup(slot.time));
    } else {
      button.textContent = selectedTime === slot.time ? "已选" : "选择";
      button.disabled = false;
      button.addEventListener("click", () => {
        selectedTime = slot.time;
        renderSchedule();
      });
    }

    scheduleGrid.append(fragment);
  }
}

async function cancelSignup(time) {
  const name = studentName.value.trim();
  if (!name) {
    setStatus("请输入报名时使用的姓名，再取消时段", "error");
    return;
  }

  setStatus("正在取消...");
  try {
    const data = await requestJson("/.netlify/functions/schedule", {
      method: "POST",
      body: JSON.stringify({ action: "cancelSignup", date: signupDate, time, name })
    });
    schedule = { date: data.date, slots: data.slots.map(normalizeSlot) };
    selectedTime = "";
    renderSchedule();
    setStatus("已取消报名");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = studentName.value.trim();
  if (!selectedTime) {
    setStatus("请先选择一个可报名时段", "error");
    return;
  }

  const submit = signupForm.querySelector("button[type='submit']");
  submit.disabled = true;
  setStatus("正在报名...");
  try {
    const data = await requestJson("/.netlify/functions/schedule", {
      method: "POST",
      body: JSON.stringify({ action: "signup", date: signupDate, time: selectedTime, name })
    });
    schedule = { date: data.date, slots: data.slots.map(normalizeSlot) };
    selectedTime = "";
    renderSchedule();
    setStatus("报名成功");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

loadSchedule();
