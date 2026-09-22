import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Pool } from "pg";

import * as app from "../src/server.ts";

const SPEAKER = {
  slug: "diana-pham",
  first_name: "Diana",
  last_name: "Pham",
  name: "Diana Pham",
  tagline: "Speaker",
  bio: "Biography",
  company: "Example",
  location: "Durham, NC",
  photo_path: "/images/speakers/diana-pham.jpg",
  twitter_url: "https://twitter.com/diana",
  linkedin_url: "https://linkedin.com/in/diana",
  website_url: "https://example.com",
  github_url: "https://github.com/diana",
  featured: true,
};

const TALK = {
  slug: "opening-keynote",
  title: "Talk",
  description: "A talk",
  format: "keynote",
  youtube_id: "abc123",
  year: 2026,
  speaker_slug: "diana-pham",
  languages: ["typescript"],
  topics: ["development"],
};

const SPONSOR = {
  slug: "flywheel",
  name: "Flywheel",
  website: "https://flywheel.com",
  logo_path: "/images/sponsors/flywheel.png",
  description: "Sponsor",
  twitter_url: "https://twitter.com/flywheel",
  linkedin_url: "https://linkedin.com/company/flywheel",
  youtube_url: "",
  instagram_url: "",
  facebook_url: "",
};

const YEAR_SPONSOR = {
  ...SPONSOR,
  blurb: "Year blurb",
  tier: "platinum",
  featured: true,
  year: 2026,
};

const YEAR = {
  year: 2026,
  slug: "2026",
  name: "Carolina Code Conference 2026",
  status: "past",
};

function fakeCatalog(sql: string, params: unknown[]): app.Json[] {
  if (sql.includes("FROM v1_years")) {
    return [{ ...YEAR }];
  }
  if (sql.includes("FROM v1_speakers WHERE slug =")) {
    return params[0] === "diana-pham" ? [{ ...SPEAKER }] : [];
  }
  if (sql.includes("FROM v1_speakers")) {
    return [{ ...SPEAKER }];
  }
  if (sql.includes("SELECT DISTINCT year FROM v1_talks")) {
    return params[0] === "diana-pham" ? [{ year: 2026 }, { year: 2024 }] : [];
  }
  if (sql.includes("FROM v1_talks WHERE speaker_slug = ANY")) {
    return [
      { speaker_slug: "diana-pham", year: 2026 },
      { speaker_slug: "diana-pham", year: 2024 },
    ];
  }
  if (sql.includes("FROM v1_talks WHERE speaker_slug =")) {
    if (params[0] !== "diana-pham") return [];
    if (params[1] != null && Number(params[1]) !== 2026) return [];
    return [{ ...TALK }];
  }
  if (sql.includes("FROM v1_talks")) {
    return [{ ...TALK }];
  }
  if (sql.includes("FROM v1_year_sponsors WHERE year =") && sql.includes("AND slug =")) {
    return Number(params[0]) === 2026 && params[1] === "flywheel" ? [{ ...YEAR_SPONSOR }] : [];
  }
  if (sql.includes("FROM v1_year_sponsors")) {
    return [{ ...YEAR_SPONSOR }];
  }
  if (sql.includes("SELECT DISTINCT year FROM v1_sponsorships")) {
    return params[0] === "flywheel" ? [{ year: 2026 }, { year: 2025 }] : [];
  }
  if (sql.includes("FROM v1_sponsors WHERE slug =")) {
    return params[0] === "flywheel" ? [{ ...SPONSOR }] : [];
  }
  if (sql.includes("FROM v1_sponsors")) {
    return [{ ...SPONSOR }];
  }
  if (sql.includes("FROM v1_sponsorships")) {
    return params[0] === "flywheel"
      ? [{ sponsor_slug: "flywheel", year: 2026, tier: "platinum" }]
      : [];
  }
  return [];
}

function dummyPool(): Pool {
  return {
    end: async () => undefined,
    query: async () => ({ rows: [] }),
  } as unknown as Pool;
}

describe("v1 handler via shipped HTTP server", { concurrency: false }, () => {
  let server: Server;
  let baseUrl = "";

  async function get(path: string): Promise<{ status: number; body: app.Json }> {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: (await res.json()) as app.Json };
  }

  before(async () => {
    app.setQueryFn(fakeCatalog);
    app.setConnectFn(dummyPool);
    process.env.PORT = "0";
    delete process.env.CAROLINA_URL;
    delete process.env.POLYGLOT_REGISTER_TOKEN;
    server = app.startServer();
    await once(server, "listening");
    const info = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${info.port}`;
  });

  after(async () => {
    app.setQueryFn(null);
    app.setConnectFn(null);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    app.setSqlCount(0);
  });

  test("/health is ok JSON and does not run SQL or connect", async () => {
    const connects = app.connectCount;
    const { status, body } = await get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(app.sqlCount, 0);
    assert.equal(app.connectCount, connects);
  });

  test("route(/health) is liveness with no SQL and no connect", async () => {
    app.resetCounts();
    const result = await app.route("/health", ["health"], null);
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, { ok: true });
    assert.equal(app.sqlCount, 0);
    assert.equal(app.connectCount, 0);
  });

  test("GET / identity is TypeScript / node:http with endpoints list", async () => {
    const connects = app.connectCount;
    const { status, body } = await get("/");
    assert.equal(status, 200);
    assert.equal(body.language, "TypeScript");
    assert.equal(body.framework, "node:http");
    assert.equal(app.sqlCount, 0);
    assert.equal(app.connectCount, connects);
    assert.ok(Array.isArray(body.endpoints));
    const endpoints = body.endpoints as { method: string; path: string }[];
    assert.ok(endpoints.length > 0);
    const paths = endpoints.map((item) => item.path);
    assert.ok(paths.includes("/"));
    assert.ok(paths.includes("/health"));
    assert.ok(paths.includes("/v1/years"));
    assert.ok(paths.includes("/v1/speakers"));
    assert.ok(paths.includes("/v1/sponsors"));
  });

  test("GET /v1/years returns conference years", async () => {
    const { status, body } = await get("/v1/years");
    assert.equal(status, 200);
    const data = body.data as app.Json[];
    assert.ok(Array.isArray(data));
    assert.ok(data.some((row) => Number(row.year) === 2026));
    assert.ok(app.sqlCount > 0);
  });

  test("GET /v1/speakers lists speakers from the catalog", async () => {
    const { status, body } = await get("/v1/speakers");
    assert.equal(status, 200);
    const data = body.data as app.Json[];
    assert.ok(Array.isArray(data));
    assert.ok(data.some((row) => row.slug === "diana-pham"));
  });

  test("GET /v1/speakers?year=2026 includes languages, topics, years DESC", async () => {
    const { status, body } = await get("/v1/speakers?year=2026");
    assert.equal(status, 200);
    const data = body.data as app.Json[];
    assert.ok(data.length >= 1);
    const speaker = data.find((row) => row.slug === "diana-pham");
    assert.ok(speaker);
    assert.equal(speaker.year, 2026);
    assert.deepEqual(speaker.languages, ["typescript"]);
    assert.deepEqual(speaker.topics, ["development"]);
    const years = speaker.years as number[];
    assert.ok(Array.isArray(years));
    assert.ok(years.length >= 2);
    for (let i = 1; i < years.length; i++) {
      assert.ok(years[i - 1] >= years[i], `years not DESC: ${years.join(",")}`);
    }
  });

  test("GET /v1/speakers/:slug returns speaker detail", async () => {
    const { status, body } = await get("/v1/speakers/diana-pham");
    assert.equal(status, 200);
    const speaker = body.data as app.Json;
    assert.equal(speaker.slug, "diana-pham");
    assert.ok(Array.isArray(speaker.talks));
    assert.ok((speaker.talks as app.Json[]).length > 0);
  });

  test("GET /v1/speakers/:year/:slug returns year-scoped speaker", async () => {
    const { status, body } = await get("/v1/speakers/2026/diana-pham");
    assert.equal(status, 200);
    const speaker = body.data as app.Json;
    assert.equal(speaker.slug, "diana-pham");
    assert.equal(speaker.year, 2026);
    const talks = speaker.talks as app.Json[];
    assert.ok(talks.length > 0);
    assert.equal(talks[0].title, "Talk");
    assert.ok(Array.isArray(speaker.languages));
    assert.ok(Array.isArray(speaker.topics));
  });

  test("GET /v1/sponsors lists sponsors from the catalog", async () => {
    const { status, body } = await get("/v1/sponsors");
    assert.equal(status, 200);
    const data = body.data as app.Json[];
    assert.ok(data.some((row) => row.slug === "flywheel"));
  });

  test("GET /v1/sponsors?year=2026 includes tier", async () => {
    const { status, body } = await get("/v1/sponsors?year=2026");
    assert.equal(status, 200);
    const data = body.data as app.Json[];
    assert.ok(data.length >= 1);
    const sponsor = data.find((row) => row.slug === "flywheel");
    assert.ok(sponsor);
    assert.equal(sponsor.tier, "platinum");
  });

  test("GET /v1/sponsors/:slug returns sponsor detail", async () => {
    const { status, body } = await get("/v1/sponsors/flywheel");
    assert.equal(status, 200);
    const sponsor = body.data as app.Json;
    assert.equal(sponsor.slug, "flywheel");
    assert.ok(Array.isArray(sponsor.sponsorships));
  });

  test("GET /v1/sponsors/:year/:slug returns year-scoped sponsor", async () => {
    const { status, body } = await get("/v1/sponsors/2026/flywheel");
    assert.equal(status, 200);
    const sponsor = body.data as app.Json;
    assert.equal(sponsor.slug, "flywheel");
    assert.equal(sponsor.tier, "platinum");
    assert.equal(sponsor.year, 2026);
  });

  test("unknown speaker slug is 404 not_found", async () => {
    const { status, body } = await get("/v1/speakers/no-such-slug");
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "not_found" });
  });

  test("unknown year-scoped speaker is 404 not_found", async () => {
    const { status, body } = await get("/v1/speakers/2026/no-such-slug");
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "not_found" });
  });

  test("unknown sponsor slug is 404 not_found", async () => {
    const { status, body } = await get("/v1/sponsors/no-such-slug");
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "not_found" });
  });

  test("unknown year-scoped sponsor is 404 not_found", async () => {
    const { status, body } = await get("/v1/sponsors/2026/missing-sponsor");
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "not_found" });
  });

  test("unknown path is 404 not_found", async () => {
    const { status, body } = await get("/not-a-route");
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "not_found" });
  });

  test("/health responds on 127.0.0.1 and ::1 without SQL or a new pool connect", async () => {
    const info = server.address() as AddressInfo;
    assert.equal(app.listenHost(), "::");
    assert.equal(info.family, "IPv6");
    const connects = app.connectCount;
    const v4 = await fetch(`http://127.0.0.1:${info.port}/health`);
    const v6 = await fetch(`http://[::1]:${info.port}/health`);
    assert.equal(v4.status, 200);
    assert.deepEqual(await v4.json(), { ok: true });
    assert.equal(v6.status, 200);
    assert.deepEqual(await v6.json(), { ok: true });
    assert.equal(app.sqlCount, 0);
    assert.equal(app.connectCount, connects);
  });

  test("identity and health do not query or open a pool", async () => {
    app.resetPool();
    app.setQueryFn(() => {
      throw new Error("sql");
    });
    app.setConnectFn(() => {
      throw new Error("connect");
    });
    app.resetCounts();
    try {
      const health = await app.route("/health", ["health"], null);
      const home = await app.route("/", [], null);
      assert.equal(health.status, 200);
      assert.deepEqual(health.payload, { ok: true });
      assert.equal(home.status, 200);
      assert.equal((home.payload as app.Json).language, "TypeScript");
      assert.equal((home.payload as app.Json).framework, "node:http");
      assert.equal(app.sqlCount, 0);
      assert.equal(app.connectCount, 0);
    } finally {
      app.setQueryFn(fakeCatalog);
      app.setConnectFn(dummyPool);
      app.resetPool();
      app.ensurePool();
    }
  });

  test("year speaker listing is a bounded query count and reuses one pool", async () => {
    const slugs = ["s0", "s1", "s2"];
    function rowsFor(sql: string): app.Json[] {
      if (sql.includes("FROM v1_speakers")) {
        return slugs.map((slug, index) => ({
          slug,
          first_name: "A",
          last_name: `B${index}`,
          name: slug,
          featured: false,
        }));
      }
      if (sql.includes("FROM v1_talks WHERE year")) {
        return slugs.map((slug) => ({
          slug: `talk-${slug}`,
          title: "Talk",
          description: "",
          format: "talk",
          youtube_id: "",
          year: 2026,
          speaker_slug: slug,
          languages: ["typescript"],
          topics: ["development"],
        }));
      }
      if (sql.includes("ANY(")) {
        return slugs.flatMap((slug) => [
          { speaker_slug: slug, year: 2026 },
          { speaker_slug: slug, year: 2024 },
        ]);
      }
      return [];
    }

    app.resetPool();
    app.setQueryFn(null);
    let opened = 0;
    app.setConnectFn(() => {
      opened += 1;
      return {
        end: async () => undefined,
        query: async (sql: string) => ({ rows: rowsFor(sql) }),
      } as unknown as Pool;
    });
    app.setSqlCount(0);
    app.setConnectCount(0);

    try {
      const first = await app.route("/v1/speakers", ["v1", "speakers"], "2026");
      assert.equal(first.status, 200);
      const data = (first.payload as { data: app.Json[] }).data;
      assert.equal(data.length, slugs.length);
      assert.ok(app.sqlCount > 0);
      assert.ok(app.sqlCount < 2 * data.length);
      assert.ok(app.sqlCount <= 4);
      assert.equal(opened, 1);
      assert.equal(app.connectCount, 1);
      for (const speaker of data) {
        assert.deepEqual(speaker.languages, ["typescript"]);
        assert.deepEqual(speaker.topics, ["development"]);
        const years = speaker.years as number[];
        assert.ok(years.length >= 2);
        for (let i = 1; i < years.length; i++) {
          assert.ok(Number(years[i - 1]) >= Number(years[i]));
        }
      }
      const boot = app.connectCount;
      const bounded = app.sqlCount;
      app.setSqlCount(0);
      const second = await app.route("/v1/speakers", ["v1", "speakers"], "2026");
      assert.equal(second.status, 200);
      assert.equal(app.sqlCount, bounded);
      assert.equal(opened, 1);
      assert.equal(app.connectCount, boot);
    } finally {
      app.setQueryFn(fakeCatalog);
      app.setConnectFn(dummyPool);
      app.resetPool();
      app.ensurePool();
    }
  });
});
