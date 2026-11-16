const SETTINGS_KEY = "aigf.settings";
const HISTORY_KEY = "aigf.history";
const PHOTO_KEY = "aigf.photo";
const VOICE_KEY = "aigf.voice";
const PHOTO_MAX_SIDE = 1000;

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
let photo = load(PHOTO_KEY, null);
let voiceOn = load(VOICE_KEY, false);
let busy = false;

// Shrink the chosen picture so it fits in browser storage, and return it as a data URL.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function renderAvatar() {
  const avatar = $("avatar");
  avatar.classList.toggle("has-photo", Boolean(photo));
  avatar.style.backgroundImage = photo ? `url("${photo}")` : "";
  avatar.textContent = herName().charAt(0).toUpperCase();
  $("stage").hidden = !photo;
  if (photo) $("stage-img").src = photo;
}

function renderVoiceButton() {
  const btn = $("voice-btn");
  btn.hidden = !("speechSynthesis" in window);
  btn.textContent = voiceOn ? "Voice on" : "Voice off";
  btn.setAttribute("aria-pressed", String(voiceOn));
}

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const preferred = /female|samantha|zira|aria|jenny|google us english|karen|moira|tessa/i;
  return voices.find((v) => preferred.test(v.name)) ?? voices[0] ?? null;
}

// Read her reply out loud using the browser's built-in voice.
function speak(text) {
  if (!voiceOn || !("speechSynthesis" in window)) return;
  const spoken = text.replace(/\p{Extended_Pictographic}/gu, "").trim();
  if (!spoken) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(spoken);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.pitch = 1.1;
  utterance.onstart = () => $("stage").classList.add("speaking");
  utterance.onend = utterance.onerror = () => $("stage").classList.remove("speaking");
  speechSynthesis.speak(utterance);
}

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
  setupForm.elements.photo.value = "";
  $("remove-photo").hidden = !photo;
  chatScreen.hidden = true;
  setupScreen.hidden = false;
}

function showChat() {
  $("her-name").textContent = herName();
  renderAvatar();
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
  $("stage").classList.toggle("typing", value);
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
    speak(reply);
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

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(setupForm);
  const file = data.get("photo");
  if (file && file.size > 0) {
    try {
      photo = await shrinkPhoto(file);
      save(PHOTO_KEY, photo);
    } catch {
      alert("That file couldn't be used as a picture. Try a JPG or PNG.");
      return;
    }
  }
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

$("remove-photo").addEventListener("click", () => {
  photo = null;
  save(PHOTO_KEY, null);
  $("remove-photo").hidden = true;
});

function openPhoto() {
  if (!photo) return;
  $("photo-large").src = photo;
  $("photo-view").showModal();
}
$("avatar").addEventListener("click", openPhoto);
$("stage").addEventListener("click", openPhoto);

$("voice-btn").addEventListener("click", () => {
  voiceOn = !voiceOn;
  save(VOICE_KEY, voiceOn);
  if (!voiceOn) speechSynthesis.cancel();
  renderVoiceButton();
});
renderVoiceButton();

$("reset-btn").addEventListener("click", () => {
  if (busy) return;
  if (history.length && !confirm("Start a new chat? This erases the current conversation.")) return;
  history = [];
  save(HISTORY_KEY, history);
  renderHistory();
});

if (settings) showChat();
else showSetup();
