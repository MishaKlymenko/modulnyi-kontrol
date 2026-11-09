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

  const endpoint = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.SUBMISSION_SHARED_SECRET;
  if (!endpoint || !secret) {
    console.error("Missing Google Sheets submission environment variables");
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

  let target;
  try {
    target = new URL(endpoint);
  } catch {
    console.error("GOOGLE_APPS_SCRIPT_URL is invalid");
    return reply(res, 503, { error: "Submission storage is not configured" });
  }
  if (target.protocol !== "https:" || target.hostname !== "script.google.com" || !target.pathname.startsWith("/macros/s/") || !target.pathname.endsWith("/exec")) {
    console.error("GOOGLE_APPS_SCRIPT_URL must be a Google Apps Script web app URL");
    return reply(res, 503, { error: "Submission storage is not configured" });
  }

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret })
    });
    if (!upstream.ok) {
      console.error("Google Apps Script returned HTTP", upstream.status);
      return reply(res, 502, { error: "Unable to save submission" });
    }

    const result = await upstream.json();
    if (result?.saved !== true) {
      console.error("Google Apps Script did not confirm the submission");
      return reply(res, 502, { error: "Unable to save submission" });
    }
    return reply(res, 201, { saved: true });
  } catch (error) {
    console.error("Google Sheets submission request failed:", error.message);
    return reply(res, 502, { error: "Unable to save submission" });
  }
};
