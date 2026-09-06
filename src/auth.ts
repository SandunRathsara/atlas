import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

const SESSION_COOKIE = "atlas_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CSRF_TTL_MS = 15 * 60 * 1000;

export type AuthIdentity =
  | { type: "bearer" }
  | { type: "browser"; sessionId: string; expiresAt: number };

export type AuthEnv = {
  Variables: {
    auth: AuthIdentity;
  };
};

type AuthOptions = {
  allowedOrigin?: string;
  getSharedToken?: () => string | undefined;
  now?: () => number;
  sharedToken?: string;
};

type BrowserSession = {
  expiresAt: number;
  tokenDigest: Buffer;
};

type CsrfNonce = {
  expiresAt: number;
  sessionId?: string;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

const secretsMatch = (provided: string, expected: string) =>
  timingSafeEqual(digest(provided), digest(expected));

const getCookie = (header: string | undefined, name: string) => {
  for (const item of header?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
};

const cookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;

const isHtmx = (c: Context) => c.req.header("HX-Request") === "true";

const isNonDocumentRequest = (c: Context) =>
  c.req.method !== "GET" ||
  isHtmx(c) ||
  c.req.header("Authorization") !== undefined ||
  c.req.header("Accept")?.includes("text/event-stream") === true;

export const safeReturnTo = (value: string | undefined | null) => {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) {
    return "/repositories";
  }

  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return "/repositories";
  }

  try {
    const parsed = new URL(value, "https://atlas.invalid");
    if (parsed.origin !== "https://atlas.invalid") return "/repositories";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/repositories";
  }
};

export const createAuth = (options: AuthOptions) => {
  const getSharedToken =
    options.getSharedToken ?? (() => options.sharedToken);
  const now = options.now ?? Date.now;
  const initialToken = getSharedToken();

  if (!initialToken) {
    throw new Error("ATLAS_SHARED_TOKEN is required");
  }

  const sessions = new Map<string, BrowserSession>();
  const csrfNonces = new Map<string, CsrfNonce>();

  const isSameOrigin = (c: Context) => {
    const origin = c.req.header("Origin");
    if (!origin) return false;

    const expected = options.allowedOrigin ?? new URL(c.req.url).origin;
    return origin === expected;
  };

  const pruneCsrfNonces = () => {
    const timestamp = now();
    for (const [nonce, record] of csrfNonces) {
      if (record.expiresAt <= timestamp) csrfNonces.delete(nonce);
    }
  };

  const authenticate = (c: Context): AuthIdentity | undefined => {
    const sharedToken = getSharedToken();
    if (!sharedToken) return undefined;

    const authorization = c.req.header("Authorization");
    if (authorization !== undefined) {
      const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
      return match && secretsMatch(match[1], sharedToken)
        ? { type: "bearer" }
        : undefined;
    }

    const sessionId = getCookie(c.req.header("Cookie"), SESSION_COOKIE);
    if (!sessionId) return undefined;

    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(sessionId);
      return undefined;
    }

    if (!timingSafeEqual(session.tokenDigest, digest(sharedToken))) {
      sessions.delete(sessionId);
      return undefined;
    }

    return { type: "browser", sessionId, expiresAt: session.expiresAt };
  };

  const middleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const identity = authenticate(c);
    if (identity) {
      c.set("auth", identity);
      await next();
      return;
    }

    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "HX-Request");
    c.header("WWW-Authenticate", 'Bearer realm="Atlas"');

    if (isNonDocumentRequest(c)) {
      return c.text("Authentication required", 401);
    }

    const requestUrl = new URL(c.req.url);
    const returnTo = safeReturnTo(`${requestUrl.pathname}${requestUrl.search}`);
    return c.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`, 303);
  };

  const issueCsrf = (sessionId?: string) => {
    pruneCsrfNonces();
    const nonce = crypto.randomUUID();
    csrfNonces.set(nonce, { expiresAt: now() + CSRF_TTL_MS, sessionId });
    return nonce;
  };

  const consumeCsrf = (nonce: string | undefined, sessionId?: string) => {
    if (!nonce) return false;
    const record = csrfNonces.get(nonce);
    if (!record || record.expiresAt <= now() || record.sessionId !== sessionId) {
      csrfNonces.delete(nonce);
      return false;
    }

    csrfNonces.delete(nonce);
    return true;
  };

  return {
    authenticate,
    clearSessionCookie: () => cookie("", 0),
    createSession: () => {
      const sharedToken = getSharedToken();
      if (!sharedToken) throw new Error("ATLAS_SHARED_TOKEN is required");

      const sessionId = crypto.randomUUID();
      const expiresAt = now() + SESSION_TTL_MS;
      sessions.set(sessionId, { expiresAt, tokenDigest: digest(sharedToken) });
      return {
        cookie: cookie(sessionId, SESSION_TTL_MS / 1000),
        identity: { type: "browser" as const, sessionId, expiresAt },
      };
    },
    endSession: (identity: AuthIdentity) => {
      if (identity.type !== "browser") return;
      sessions.delete(identity.sessionId);
      for (const [nonce, record] of csrfNonces) {
        if (record.sessionId === identity.sessionId) csrfNonces.delete(nonce);
      }
    },
    isSameOrigin,
    matchesSharedToken: (provided: string) => {
      const sharedToken = getSharedToken();
      return Boolean(sharedToken) && secretsMatch(provided, sharedToken!);
    },
    middleware,
    issueCsrf,
    validateBrowserMutation: (c: Context, identity: AuthIdentity, nonce?: string) =>
      identity.type === "bearer" ||
      (identity.type === "browser" &&
        isSameOrigin(c) &&
        consumeCsrf(nonce, identity.sessionId)),
    validateLogin: (c: Context, nonce: string | undefined) =>
      isSameOrigin(c) && consumeCsrf(nonce),
  };
};
