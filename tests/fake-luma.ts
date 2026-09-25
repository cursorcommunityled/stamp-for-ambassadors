/**
 * A stand-in for Luma's public API, so every flow that depends on Luma can be
 * tested without a real calendar key. Serves the four endpoints the app calls
 * (see src/lib/luma.ts) from memory, plus `/__fake/*` routes the tests use to
 * set up events, scan someone in, count calls, or make Luma misbehave.
 *
 *   npx tsx tests/fake-luma.ts            # listens on FAKE_LUMA_PORT (3199)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const FAKE_LUMA_KEY = "test-luma-key";
const PORT = Number(process.env.FAKE_LUMA_PORT ?? 3199);

export type FakeGuest = {
  id: string;
  email: string;
  name?: string | null;
  approval_status: string;
  registered_at?: string | null;
  checked_in_at?: string | null;
};

export type FakeEvent = {
  id: string;
  /** Public slug, as in luma.com/<slug>. */
  slug: string;
  name: string;
  start_at?: string | null;
  end_at?: string | null;
  timezone?: string | null;
  description?: string | null;
  city?: string | null;
  hosts?: string[];
  guests?: FakeGuest[];
};

type Mode = "ok" | "error" | "unauthorized" | "slow";

const state = {
  events: new Map<string, FakeEvent>(),
  calls: [] as string[],
  mode: "ok" as Mode,
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function eventBody(event: FakeEvent) {
  return {
    event: {
      id: event.id,
      name: event.name,
      start_at: event.start_at ?? null,
      end_at: event.end_at ?? null,
      timezone: event.timezone ?? "Europe/Skopje",
      url: `https://luma.com/${event.slug}`,
      cover_url: null,
      description: event.description ?? null,
      geo_address_json: event.city ? { city: event.city, country: "Testland" } : null,
      location_type: "offline",
    },
    hosts: (event.hosts ?? []).map((email) => ({ email })),
  };
}

function guestBody(guest: FakeGuest) {
  return {
    guest: {
      id: guest.id,
      user_email: guest.email,
      user_name: guest.name ?? null,
      approval_status: guest.approval_status,
      registered_at: guest.registered_at ?? new Date().toISOString(),
      checked_in_at: guest.checked_in_at ?? null,
    },
  };
}

function page<T>(items: T[], url: URL) {
  const limit = Number(url.searchParams.get("pagination_limit") ?? 50);
  const start = Number(url.searchParams.get("pagination_cursor") ?? 0);
  const slice = items.slice(start, start + limit);
  const next = start + limit;
  return {
    entries: slice,
    has_more: next < items.length,
    next_cursor: next < items.length ? String(next) : null,
  };
}

async function control(req: IncomingMessage, res: ServerResponse, url: URL) {
  const body = (req.method === "POST" ? await readBody(req) : {}) as Record<string, unknown>;
  switch (url.pathname) {
    case "/__fake/reset":
      state.events.clear();
      state.calls = [];
      state.mode = "ok";
      return send(res, 200, { ok: true });
    case "/__fake/event": {
      const event = body as unknown as FakeEvent;
      state.events.set(event.id, { guests: [], hosts: [], ...event });
      return send(res, 200, { ok: true });
    }
    case "/__fake/remove-event":
      state.events.delete(String(body.id));
      return send(res, 200, { ok: true });
    case "/__fake/hosts": {
      const event = state.events.get(String(body.eventId));
      if (!event) return send(res, 404, { error: "no event" });
      event.hosts = body.hosts as string[];
      return send(res, 200, { ok: true });
    }
    case "/__fake/guest": {
      const event = state.events.get(String(body.eventId));
      if (!event) return send(res, 404, { error: "no event" });
      const guest = body.guest as FakeGuest;
      event.guests = [...(event.guests ?? []).filter((g) => g.id !== guest.id), guest];
      return send(res, 200, { ok: true });
    }
    case "/__fake/checkin": {
      const event = state.events.get(String(body.eventId));
      const guest = event?.guests?.find(
        (g) => g.email.toLowerCase() === String(body.email).toLowerCase(),
      );
      if (!guest) return send(res, 404, { error: "no guest" });
      guest.checked_in_at = new Date().toISOString();
      if (body.approve) guest.approval_status = "approved";
      return send(res, 200, { ok: true });
    }
    case "/__fake/mode":
      state.mode = (body.mode as Mode) ?? "ok";
      return send(res, 200, { ok: true });
    case "/__fake/calls":
      return send(res, 200, { calls: state.calls });
    default:
      return send(res, 404, { error: "unknown control route" });
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  state.calls.push(url.pathname);

  if (state.mode === "slow") await new Promise((r) => setTimeout(r, 10_000));
  if (state.mode === "error") return send(res, 500, { message: "fake outage" });
  if (
    state.mode === "unauthorized" ||
    req.headers["x-luma-api-key"] !== FAKE_LUMA_KEY
  ) {
    return send(res, 401, { message: "invalid api key" });
  }

  const eventId = url.searchParams.get("event_id") ?? "";
  const event = state.events.get(eventId);

  switch (url.pathname) {
    case "/v1/events/get":
      return event ? send(res, 200, eventBody(event)) : send(res, 404, { message: "not found" });
    case "/v1/calendars/events/list":
      return send(
        res,
        200,
        page(
          [...state.events.values()].map((e) => ({ id: e.id, url: `https://luma.com/${e.slug}` })),
          url,
        ),
      );
    case "/v1/events/guests/get": {
      if (!event) return send(res, 404, { message: "not found" });
      const id = (url.searchParams.get("id") ?? "").toLowerCase();
      const guest = event.guests?.find((g) => g.email.toLowerCase() === id || g.id === id);
      return guest ? send(res, 200, guestBody(guest)) : send(res, 404, { message: "not found" });
    }
    case "/v1/events/guests/list":
      if (!event) return send(res, 404, { message: "not found" });
      return send(res, 200, page((event.guests ?? []).map(guestBody), url));
    default:
      return send(res, 404, { message: "unknown endpoint" });
  }
}

export function startFakeLuma(port = PORT) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const handler = url.pathname.startsWith("/__fake/") ? control : api;
    handler(req, res, url).catch((error) => send(res, 500, { error: String(error) }));
  });
  server.listen(port);
  return server;
}

if (process.argv[1]?.endsWith("fake-luma.ts")) {
  startFakeLuma();
  console.log(`fake Luma on http://localhost:${PORT}`);
}
