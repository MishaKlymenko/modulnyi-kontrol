const OWNER = "MishaKlymenko";
const REPOSITORY = "modulnyi-kontrol-results";
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/contents`;
const ALLOWED_ORIGIN = process.env.SUBMISSIONS_ALLOWED_ORIGIN || "https://modulnyi-kontrol.vercel.app";
const MAX_BODY_BYTES = 80_000;

function reply(res, status, body) {
  res.status(status).json(body);
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) return false;
  if (typeof body.name !== "string" || body.name.trim().length < 3 || body.name.length > 120) return false;
  if (!Number.isInteger(body.variant) || body.variant < 1 || body.variant > 10) return false;
  if (typeof body.reason !== "string" || body.reason.length > 120) return false;
  if (typeof body.finished !== "string" || Number.isNaN(Date.parse(body.finished))) return false;
  if (!Number.isInteger(body.focusWarnings) || body.focusWarnings < 0 || body.focusWarnings > 100) return false;
  if (!Array.isArray(body.focusLog) || body.focusLog.length > 100) return false;
  if (!body.focusLog.every(entry => entry && typeof entry.at === "string" && entry.at.length <= 40 && Number.isInteger(entry.seconds) && entry.seconds >= 0 && entry.seconds <= 10)) return false;
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return false;
  const allowedKeys = new Set(["t0", "t1", "t2", "t3", "t4", "p0", "p1"]);
  return Object.entries(body.answers).every(([key, value]) => allowedKeys.has(key) && typeof value === "string" && value.length <= 10_000);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }

  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return reply(res, 415, { error: "Expected JSON" });
  }

  if (req.headers.origin !== ALLOWED_ORIGIN) {
    return reply(res, 403, { error: "Origin not allowed" });
  }

  const token = process.env.SUBMISSIONS_GITHUB_TOKEN;
  if (!token) {
    console.error("Missing SUBMISSIONS_GITHUB_TOKEN environment variable");
    return reply(res, 503, { error: "Submission storage is not configured" });
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_BODY_BYTES || !validate(payload)) {
      return reply(res, 400, { error: "Invalid submission" });
    }
  } catch {
    return reply(res, 400, { error: "Invalid submission" });
  }

  const path = `submissions/${payload.id}.json`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "modulnyi-kontrol-submissions"
  };

  try {
    const fileUrl = `${API_BASE}/${path}`;
    const existing = await fetch(`${fileUrl}?ref=main`, { headers });
    let sha;
    if (existing.ok) {
      sha = (await existing.json()).sha;
    } else if (existing.status !== 404) {
      console.error("Unable to check submission file:", existing.status);
      return reply(res, 502, { error: "Unable to save submission" });
    }

    const data = {
      id: payload.id,
      name: payload.name.trim().replace(/\s+/g, " "),
      variant: payload.variant,
      answers: payload.answers,
      reason: payload.reason,
      focusWarnings: payload.focusWarnings,
      focusLog: payload.focusLog,
      finished: payload.finished
    };
    const content = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8").toString("base64");
    const saved = await fetch(fileUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Save student submission",
        content,
        branch: "main",
        ...(sha ? { sha } : {})
      })
    });

    if (!saved.ok) {
      console.error("Unable to save submission:", saved.status);
      return reply(res, 502, { error: "Unable to save submission" });
    }
    return reply(res, 201, { saved: true });
  } catch (error) {
    console.error("Submission storage request failed:", error.message);
    return reply(res, 502, { error: "Unable to save submission" });
  }
};
