const SETTINGS_KEY = "aigf.settings";
const HISTORY_KEY = "aigf.history";

const $ = (id) => document.getElementById(id);
const setupScreen = $("setup");
const chatScreen = $("chat");
const setupForm = $("setup-form");
const messagesEl = $("messages");
const composer = $("composer");
const input = $("input");
const sendBtn = $("send");

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the chat still works, it just won't be remembered.
  }
}

let settings = load(SETTINGS_KEY, null);
let history = load(HISTORY_KEY, []);
let busy = false;

function herName() {
  return settings?.herName || "Mia";
}

function showSetup() {
  if (settings) {
    for (const field of ["herName", "userName", "personality", "about"]) {
      setupForm.elements[field].value = settings[field] ?? "";
    }
    setupForm.elements.adult.checked = true;
  }
  chatScreen.hidden = true;
  setupScreen.hidden = false;
}

function showChat() {
  $("her-name").textContent = herName();
  $("avatar").textContent = herName().charAt(0).toUpperCase();
  setupScreen.hidden = true;
  chatScreen.hidden = false;
  renderHistory();
  input.focus();
}

function addBubble(role, text) {
  messagesEl.querySelector(".empty")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  messagesEl.append(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function renderHistory() {
  messagesEl.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = `Say hi to ${herName()} to get started.`;
    messagesEl.append(empty);
    return;
  }
  for (const m of history) addBubble(m.role, m.content);
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  $("status").textContent = value ? "typing..." : "AI companion";
}

async function send(text) {
  history.push({ role: "user", content: text });
  save(HISTORY_KEY, history);
  addBubble("user", text);

  setBusy(true);
  const bubble = addBubble("assistant", "...");
  bubble.classList.add("typing");
  let reply = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, messages: history }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Something went wrong. Try again.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reply += decoder.decode(value, { stream: true });
      bubble.classList.remove("typing");
      bubble.textContent = reply;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    if (!reply.trim()) throw new Error("No reply came back. Try again.");

    history.push({ role: "assistant", content: reply });
    save(HISTORY_KEY, history);
  } catch (err) {
    if (reply.trim()) {
      // Connection dropped partway through: keep what she managed to say.
      history.push({ role: "assistant", content: reply });
    } else {
      // Nothing came back: take the message out of history so it can be resent.
      bubble.remove();
      history.pop();
      input.value = text;
    }
    save(HISTORY_KEY, history);
    const message = err instanceof TypeError ? "Can't reach the app server. Is it still running?" : err.message;
    addBubble("error", message);
  } finally {
    setBusy(false);
    input.focus();
  }
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(setupForm);
  settings = {
    herName: data.get("herName").trim() || "Mia",
    userName: data.get("userName").trim(),
    personality: data.get("personality"),
    about: data.get("about").trim(),
  };
  save(SETTINGS_KEY, settings);
  showChat();
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  input.style.height = "auto";
  send(text);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

$("settings-btn").addEventListener("click", showSetup);

$("reset-btn").addEventListener("click", () => {
  if (busy) return;
  if (history.length && !confirm("Start a new chat? This erases the current conversation.")) return;
  history = [];
  save(HISTORY_KEY, history);
  renderHistory();
});

if (settings) showChat();
else showSetup();
