import http from "node:http";
import { URL } from "node:url";
import { Pool } from "pg";

const LANGUAGE = "TypeScript";
const API_VERSION = "0.2.0";
const FRAMEWORK = "node:http";
const CREATED_YEAR = 2026;
const SCHEMA_VERSION = 1;
const LANGUAGE_VERSION = process.versions.node;

const ENDPOINTS = [
  { method: "GET", path: "/", query: [] as string[] },
  { method: "GET", path: "/health", query: [] as string[] },
  { method: "GET", path: "/v1/years", query: [] as string[] },
  { method: "GET", path: "/v1/speakers", query: ["year"] },
  { method: "GET", path: "/v1/speakers/:slug", query: [] as string[] },
  { method: "GET", path: "/v1/speakers/:year/:slug", query: [] as string[] },
  { method: "GET", path: "/v1/sponsors", query: ["year"] },
  { method: "GET", path: "/v1/sponsors/:slug", query: [] as string[] },
  { method: "GET", path: "/v1/sponsors/:year/:slug", query: [] as string[] },
];

const SPEAKER_COLS =
  "slug, first_name, last_name, name, tagline, bio, company, location, " +
  "photo_path, twitter_url, linkedin_url, website_url, github_url, featured";
const YEAR_SPONSOR_COLS =
  "slug, name, website, logo_path, description, blurb, tier, featured, year, " +
  "twitter_url, linkedin_url, youtube_url, instagram_url, facebook_url";
const SPONSOR_COLS =
  "slug, name, website, logo_path, description, twitter_url, linkedin_url, " +
  "youtube_url, instagram_url, facebook_url";
const TALK_COLS =
  "slug, title, description, format, youtube_id, year, speaker_slug, languages, topics";

const DSN =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/carolina_dev";

const pool = new Pool({ connectionString: DSN });

type Json = Record<string, unknown>;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const stripped = value.trim();
    if (!stripped || stripped === "{}") return [];
    const inner =
      stripped.startsWith("{") && stripped.endsWith("}")
        ? stripped.slice(1, -1)
        : stripped;
    return inner
      .split(",")
      .map((part) => part.replace(/^"|"$/g, "").trim())
      .filter((part) => part.length > 0);
  }
  return [];
}

function clean(row: Json | null | undefined): Json | null {
  if (!row) return null;
  const out: Json = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (key === "languages" || key === "topics") {
      out[key] = asStringArray(value);
    } else if (key === "featured") {
      out[key] = Boolean(value);
    } else if (key === "year" && value != null) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function uniqTags(talks: Json[], key: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const talk of talks) {
    for (const val of asStringArray(talk[key])) {
      if (!seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
    }
  }
  return out;
}

async function talksFor(slug: string, year?: number): Promise<Json[]> {
  const params: unknown[] = [slug];
  let sql = `SELECT ${TALK_COLS} FROM v1_talks WHERE speaker_slug = $1`;
  if (year != null) {
    sql += " AND year = $2";
    params.push(year);
  }
  sql += " ORDER BY year DESC";
  const result = await pool.query(sql, params);
  return result.rows.map((row) => clean(row) as Json);
}

async function talkYears(slug: string): Promise<number[]> {
  const result = await pool.query(
    "SELECT DISTINCT year FROM v1_talks WHERE speaker_slug = $1 ORDER BY year DESC",
    [slug],
  );
  return result.rows.map((row) => Number(row.year));
}

async function sponsorYears(slug: string): Promise<number[]> {
  const result = await pool.query(
    "SELECT DISTINCT year FROM v1_sponsorships WHERE sponsor_slug = $1 ORDER BY year DESC",
    [slug],
  );
  return result.rows.map((row) => Number(row.year));
}

async function loadSpeaker(slug: string): Promise<Json | null> {
  const result = await pool.query(
    `SELECT ${SPEAKER_COLS} FROM v1_speakers WHERE slug = $1`,
    [slug],
  );
  return clean(result.rows[0]);
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  const bytes = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Polyglot-Language": LANGUAGE,
    "X-Polyglot-Framework": FRAMEWORK,
    "Content-Length": bytes.length,
  });
  res.end(bytes);
}

async function route(
  path: string,
  parts: string[],
  yearParam: string | null,
): Promise<{ status: number; payload: unknown }> {
  if (path === "/") {
    return {
      status: 200,
      payload: {
        language: LANGUAGE,
        language_version: LANGUAGE_VERSION,
        api_version: API_VERSION,
        framework: FRAMEWORK,
        created_year: CREATED_YEAR,
        schema_version: SCHEMA_VERSION,
        endpoints: ENDPOINTS,
      },
    };
  }
  if (path === "/health") {
    return { status: 200, payload: { ok: true } };
  }
  if (path === "/v1/years") {
    const result = await pool.query(
      "SELECT year, slug, name, status FROM v1_years ORDER BY year DESC",
    );
    return {
      status: 200,
      payload: { data: result.rows.map((row) => clean(row)) },
    };
  }
  if (path === "/v1/speakers") {
    if (yearParam) {
      const year = Number(yearParam);
      const result = await pool.query(
        `SELECT ${SPEAKER_COLS} FROM v1_speakers ` +
          "WHERE slug IN (SELECT speaker_slug FROM v1_talks WHERE year = $1) " +
          "ORDER BY last_name, first_name",
        [year],
      );
      const speakers: Json[] = [];
      for (const row of result.rows) {
        const speaker = clean(row) as Json;
        const talks = await talksFor(String(speaker.slug), year);
        speaker.year = year;
        speaker.talks = talks;
        speaker.languages = uniqTags(talks, "languages");
        speaker.topics = uniqTags(talks, "topics");
        speaker.years = await talkYears(String(speaker.slug));
        speakers.push(speaker);
      }
      return { status: 200, payload: { data: speakers } };
    }
    const result = await pool.query(
      `SELECT ${SPEAKER_COLS} FROM v1_speakers ORDER BY last_name, first_name`,
    );
    return {
      status: 200,
      payload: { data: result.rows.map((row) => clean(row)) },
    };
  }
  if (
    parts.length === 4 &&
    parts[0] === "v1" &&
    parts[1] === "speakers" &&
    /^\d+$/.test(parts[2])
  ) {
    const year = Number(parts[2]);
    const slug = parts[3];
    const speaker = await loadSpeaker(slug);
    if (!speaker) return { status: 404, payload: { error: "not_found" } };
    const talks = await talksFor(slug, year);
    if (talks.length === 0) {
      return { status: 404, payload: { error: "not_found" } };
    }
    const years = await talkYears(slug);
    speaker.year = year;
    speaker.years = years;
    speaker.other_years = years.filter((n) => n !== year);
    speaker.talks = talks;
    speaker.languages = uniqTags(talks, "languages");
    speaker.topics = uniqTags(talks, "topics");
    return { status: 200, payload: { data: speaker } };
  }
  if (parts.length === 3 && parts[0] === "v1" && parts[1] === "speakers") {
    const slug = parts[2];
    const speaker = await loadSpeaker(slug);
    if (!speaker) return { status: 404, payload: { error: "not_found" } };
    speaker.talks = await talksFor(slug);
    speaker.years = await talkYears(slug);
    return { status: 200, payload: { data: speaker } };
  }
  if (path === "/v1/sponsors") {
    if (yearParam) {
      const result = await pool.query(
        `SELECT ${YEAR_SPONSOR_COLS} FROM v1_year_sponsors WHERE year = $1 ORDER BY name`,
        [Number(yearParam)],
      );
      return {
        status: 200,
        payload: { data: result.rows.map((row) => clean(row)) },
      };
    }
    const result = await pool.query(
      `SELECT ${SPONSOR_COLS} FROM v1_sponsors ORDER BY name`,
    );
    return {
      status: 200,
      payload: { data: result.rows.map((row) => clean(row)) },
    };
  }
  if (
    parts.length === 4 &&
    parts[0] === "v1" &&
    parts[1] === "sponsors" &&
    /^\d+$/.test(parts[2])
  ) {
    const year = Number(parts[2]);
    const slug = parts[3];
    const result = await pool.query(
      `SELECT ${YEAR_SPONSOR_COLS} FROM v1_year_sponsors WHERE year = $1 AND slug = $2`,
      [year, slug],
    );
    const row = clean(result.rows[0]);
    if (!row) return { status: 404, payload: { error: "not_found" } };
    const years = await sponsorYears(slug);
    row.years = years;
    row.other_years = years.filter((n) => n !== year);
    return { status: 200, payload: { data: row } };
  }
  if (parts.length === 3 && parts[0] === "v1" && parts[1] === "sponsors") {
    const slug = parts[2];
    const result = await pool.query(
      `SELECT ${SPONSOR_COLS} FROM v1_sponsors WHERE slug = $1`,
      [slug],
    );
    const row = clean(result.rows[0]);
    if (!row) return { status: 404, payload: { error: "not_found" } };
    const sponsorships = await pool.query(
      "SELECT * FROM v1_sponsorships WHERE sponsor_slug = $1",
      [slug],
    );
    row.sponsorships = sponsorships.rows.map((item) => clean(item));
    return { status: 200, payload: { data: row } };
  }
  return { status: 404, payload: { error: "not_found" } };
}

async function register(port: string): Promise<void> {
  const url = process.env.CAROLINA_URL;
  const token = process.env.POLYGLOT_REGISTER_TOKEN;
  if (!url || !token) return;
  const base = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
  try {
    const resp = await fetch(
      `${url.replace(/\/$/, "")}/internal/api-endpoints/register`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: LANGUAGE,
          language_version: LANGUAGE_VERSION,
          api_version: API_VERSION,
          framework: FRAMEWORK,
          created_year: CREATED_YEAR,
          schema_version: SCHEMA_VERSION,
          base_url: base,
          endpoints: ENDPOINTS,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    console.error(`registered with elixir: ${resp.status}`);
  } catch (err) {
    console.error(`register: ${err}`);
  }
}

const port = process.env.PORT ?? "4011";
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const parts = path.split("/").filter(Boolean);
    const yearParam = url.searchParams.get("year");
    const { status, payload } = await route(path, parts, yearParam);
    send(res, status, payload);
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

void register(port);
server.listen(Number(port), "0.0.0.0", () => {
  console.error(`carolina-codes-typescript listening on :${port}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
