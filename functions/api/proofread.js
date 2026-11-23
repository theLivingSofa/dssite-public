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
const KEY_CACHE_MS = 60 * 60 * 1000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

const base64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const decodeJson = (text) => JSON.parse(new TextDecoder().decode(base64url(text)));

let accessKeys = { team: "", at: 0, keys: [] };

async function signingKeys(team) {
  if (accessKeys.team === team && Date.now() - accessKeys.at < KEY_CACHE_MS) return accessKeys.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("could not load Access keys");
  const { keys } = await response.json();
  accessKeys = { team, at: Date.now(), keys };
  return keys;
}

// Only someone who passed the Cloudflare Access login can use this endpoint.
async function isSignedIn(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  const team = env.ACCESS_TEAM_DOMAIN;
  if (!token || !team || !env.ACCESS_AUD) return false;
  try {
    const [head, body, signature] = token.split(".");
    const header = decodeJson(head);
    const claims = decodeJson(body);
    const now = Date.now() / 1000;
    const audiences = [claims.aud].flat();
    if (header.alg !== "RS256" || claims.iss !== `https://${team}` || !audiences.includes(env.ACCESS_AUD)) return false;
    if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return false;
    const jwk = (await signingKeys(team)).find(({ kid }) => kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(signature), new TextEncoder().encode(`${head}.${body}`));
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
