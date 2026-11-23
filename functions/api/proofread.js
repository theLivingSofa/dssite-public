// Free proofreading for the editor. Tries Gemini, then Cloudflare's built-in AI.
// It only returns suggestions and never saves or publishes anything.
import {
  SYSTEM_PROMPT,
  cleanSuggestions,
  parseModelReply,
  userPrompt,
  validItems,
} from "../../lib/proofread-rules.mjs";

const GEMINI_MODEL = "gemini-flash-lite-latest";
const CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 32 * 1024;
const LOGIN_TIMEOUT_MS = 2000;
const MAX_LOGIN_HEADER = 8192;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

// Only someone logged in to this TinaCloud project can use this endpoint.
async function isSignedIn(request, env) {
  const authorization = request.headers.get("authorization") ?? "";
  const clientId = env.NEXT_PUBLIC_TINA_CLIENT_ID;
  if (!clientId || authorization.length > MAX_LOGIN_HEADER || !/^Bearer [\w.-]+$/.test(authorization)) return false;
  try {
    const response = await fetch(`https://identity.tinajs.io/v2/apps/${encodeURIComponent(clientId)}/currentUser`, {
      headers: { authorization },
      redirect: "manual",
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function askGemini(items, env) {
  if (!env.GEMINI_API_KEY) throw new Error("no Gemini key");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(items) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2000, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
}

async function askCloudflare(items, env) {
  if (!env.AI) throw new Error("no Workers AI binding");
  const answer = await Promise.race([
    env.AI.run(CLOUDFLARE_MODEL, {
      temperature: 0,
      max_tokens: 1500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(items) },
      ],
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Workers AI timed out")), MODEL_TIMEOUT_MS)),
  ]);
  const reply = answer?.response ?? answer?.choices?.[0]?.message?.content;
  return typeof reply === "string" ? reply : JSON.stringify(reply);
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("x-proofread") !== "1") {
    return json({ error: "forbidden" }, 403);
  }
  if (!(await isSignedIn(request, env))) return json({ error: "forbidden" }, 403);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  let items;
  try {
    items = JSON.parse(raw).items;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!validItems(items)) return json({ error: "bad request" }, 400);

  for (const ask of [askGemini, askCloudflare]) {
    try {
      return json({ checked: true, suggestions: cleanSuggestions(parseModelReply(await ask(items, env)), items) });
    } catch {
      // Try the next free model.
    }
  }
  // Proofreading is a helper, so a failure never blocks the editor.
  return json({ checked: false, suggestions: [] });
}
