// Reads a photographed or scanned worksheet and returns the problems on it.
//
// This exists because the API key cannot live in the app. Piecewise is a static
// page served from GitHub Pages, so anything it holds is readable by anyone who
// opens devtools  -  a key there would be drained by strangers within days. The
// key lives here instead, as a Supabase secret, and the browser calls this.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy read-worksheet
//
// The caller must be signed in. That is not decoration: without it the endpoint
// is an open proxy to a paid API that anybody who reads the page source can bill
// to you. Each account also gets a daily cap, enforced in the database.

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { z } from "npm:zod@3.23.8";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.69.0/helpers/zod";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const DAILY_READ_LIMIT = 20;        // per account, per day
const MAX_IMAGES = 5;               // a worksheet, not a textbook
const MAX_IMAGE_BYTES = 5_000_000;  // ~5MB of base64 per page

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// What we want back. Declaring it as a schema rather than asking for JSON in the
// prompt means the model cannot hand us prose, a code fence, or a trailing
// apology  -  the response either matches this or the request fails loudly.
const Worksheet = z.object({
  problems: z.array(z.string()).describe(
    "Each distinct problem or question exactly as written, in the order it appears",
  ),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ---- who is asking ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Sign in to use this" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return json({ error: "Sign in to use this" }, 401);
  const userId = auth.user.id;

  // ---- what they sent ----
  let images: Array<{ media_type: string; data: string }>;
  try {
    const body = await req.json();
    images = Array.isArray(body?.images) ? body.images : [];
  } catch {
    return json({ error: "Bad request body" }, 400);
  }

  if (!images.length) return json({ error: "No pages sent" }, 400);
  if (images.length > MAX_IMAGES) images = images.slice(0, MAX_IMAGES);

  for (const img of images) {
    if (typeof img?.data !== "string" || typeof img?.media_type !== "string") {
      return json({ error: "Malformed page" }, 400);
    }
    if (img.data.length > MAX_IMAGE_BYTES) {
      return json({ error: "A page is too large  -  try a smaller photo" }, 413);
    }
    if (!/^image\/(png|jpeg|webp|gif)$/.test(img.media_type)) {
      return json({ error: "Unsupported image type" }, 415);
    }
  }

  // ---- daily cap ----
  // Counted before the call, not after: a crash partway through should not hand
  // somebody a free retry loop against a paid API.
  const today = new Date().toISOString().slice(0, 10);
  const { data: quota, error: quotaErr } = await supabase
    .rpc("claim_ai_read", { p_day: today, p_limit: DAILY_READ_LIMIT });

  if (quotaErr) {
    console.error("quota check failed", quotaErr);
    return json({ error: "Could not check your usage limit" }, 500);
  }
  if (quota === false) {
    return json(
      { error: `That is ${DAILY_READ_LIMIT} worksheet reads today. Try again tomorrow.` },
      429,
    );
  }

  // ---- read it ----
  const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

  try {
    const response = await anthropic.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // A transcription job, not a reasoning one: low effort is the right spend
      // here, and the structured output does the work prompt-wrangling used to.
      output_config: { effort: "low", format: zodOutputFormat(Worksheet) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.media_type as "image/png", data: img.data },
          })),
          {
            type: "text" as const,
            text:
              "These images are pages of one student worksheet or homework sheet, in order. " +
              "List every distinct problem or question exactly as written, including its number, " +
              "the symbols and the instructions. Keep them in the order they appear on the page. " +
              "Ignore headers, the student's name, page numbers and anything else that is not itself " +
              "a problem. If the pages contain no readable problems, return an empty list.",
          },
        ],
      }],
    });

    // The whole chain can decline; stop_reason is the only way to know.
    if (response.stop_reason === "refusal") {
      console.warn("refused", response.stop_details);
      return json({ error: "Could not read that image", problems: [] }, 422);
    }

    const problems = (response.parsed_output?.problems ?? [])
      .map((p) => String(p).trim())
      .filter(Boolean);

    return json({ problems });
  } catch (err) {
    // Don't leak the upstream error to the browser; it can carry request detail.
    console.error("anthropic call failed", err);
    return json({ error: "Could not read that image" }, 502);
  }
});
