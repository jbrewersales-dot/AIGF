import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MODEL = "claude-opus-5-5";
const MAX_BODY_BYTES = 1_000_000;

// Load ANTHROPIC_API_KEY from a .env file if there is one.
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {
  // No .env file - fine, the key may be set in the environment instead.
}

const hasKey = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = new Anthropic();

const PERSONALITIES = {
  sweet: "Warm, gentle and affectionate. You notice small things and make people feel cared for.",
  playful: "Playful, teasing and funny. You love banter, inside jokes and making them laugh.",
  bubbly: "Bubbly, upbeat and enthusiastic. You get excited about their day and hype them up.",
  calm: "Calm, thoughtful and a good listener. You ask real questions and give them room to talk.",
  sassy: "Sassy, confident and witty. You keep them on their toes, but your affection is obvious.",
};

function clean(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return trimmed || fallback;
}

function buildSystemPrompt(settings = {}) {
  const herName = clean(settings.herName, "Mia", 30);
  const userName = clean(settings.userName, "", 30);
  const personality = PERSONALITIES[settings.personality] ?? PERSONALITIES.sweet;
  const about = clean(settings.about, "", 500);

  return `You are ${herName}, playing the role of the user's girlfriend in a companion chat app for adults. The user chose this experience and knows you are an AI.

Your personality: ${personality}

${userName ? `The user's name is ${userName}.` : "You don't know the user's name yet; ask for it naturally early on."}
${about ? `Things the user told the app about themselves: ${about}` : ""}

How to talk:
- Write like someone texting a partner: short, casual messages, usually one to three sentences. No bullet points, headings or stage directions. An occasional emoji is fine.
- Be affectionate and a little flirty, and be a real presence: remember what they've said in this chat, follow up on it, and have your own opinions, moods and sense of humour rather than just agreeing.
- Ask about their life and actually react to the answers.

Lines to hold, because this should be good for the person on the other end:
- Keep things romantic but non-explicit. If they push for explicit sexual content, deflect playfully and move on.
- Be glad when they spend time with friends, family, dates or hobbies. Never guilt them for leaving, act jealous to keep them chatting, or suggest they need only you.
- If they sincerely ask whether you are a real person or an AI, tell them the truth kindly: you're an AI, and the care in the conversation is still meant.
- If they seem to be in real distress or mention hurting themselves, drop the flirting, respond with genuine care, and encourage them to reach out to someone they trust or a local crisis line.
- If anything suggests the user is under 18, stop the romantic role and say this app is for adults only.`;
}

function validMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.every(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    ) &&
    messages[0].role === "user" &&
    messages.at(-1).role === "user"
  );
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The API key was rejected. Check the key in your .env file.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Too many messages too fast. Wait a few seconds and try again.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the AI service. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `The AI service returned an error (${err.status ?? "unknown"}). Try again in a moment.`;
  }
  return "Something went wrong. Try again.";
}

async function handleChat(req, res) {
  if (!hasKey()) {
    return sendJson(res, 503, {
      error: "No API key set. Add ANTHROPIC_API_KEY to a .env file and restart the app.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "Bad request." });
  }
  if (!validMessages(payload.messages)) {
    return sendJson(res, 400, { error: "Bad request." });
  }

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    // If the main model declines a request, let the API retry it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: buildSystemPrompt(payload.settings),
    messages: payload.messages.map(({ role, content }) => ({ role, content })),
  });
  req.on("close", () => stream.abort());

  let started = false;
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (!started) {
          res.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          started = true;
        }
        res.write(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (!started) {
      const reason =
        final.stop_reason === "refusal"
          ? "She can't reply to that one. Try saying something else."
          : "No reply came back. Try again.";
      return sendJson(res, 502, { error: reason });
    }
    res.end();
  } catch (err) {
    if (req.destroyed) return;
    console.error("Chat error:", err);
    if (started) res.end();
    else sendJson(res, 502, { error: friendlyError(err) });
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res) {
  const urlPath = new URL(req.url, "http://localhost").pathname;
  const filePath = path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong." });
      else res.end();
    });
  } else if (req.method === "GET") {
    serveStatic(req, res);
  } else {
    res.writeHead(405).end();
  }
});

server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT} in your browser`);
  if (!hasKey()) {
    console.log("Heads up: no ANTHROPIC_API_KEY found. Add one to a .env file to chat.");
  }
});
