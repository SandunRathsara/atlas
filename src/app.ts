import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createAuth,
  safeReturnTo,
  type AuthEnv,
} from "./auth.ts";
import { renderLoginForm, renderLoginPage, renderRepositoriesPage } from "./views.ts";

const MAX_FORM_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 8 * 1024;

type AppOptions = {
  allowedOrigin?: string;
  getSharedToken?: () => string | undefined;
  now?: () => number;
  sharedToken?: string;
};

const isHtmx = (c: { req: { header: (name: string) => string | undefined } }) =>
  c.req.header("HX-Request") === "true";

const stringField = (value: unknown) => (typeof value === "string" ? value : undefined);

const tooLarge = (contentLength: string | undefined) => {
  if (!contentLength) return false;
  const length = Number(contentLength);
  return !Number.isSafeInteger(length) || length < 0 || length > MAX_FORM_BYTES;
};

class FormBodyTooLarge extends Error {}

const parseForm = async (request: Request): Promise<Record<string, unknown>> => {
  if (tooLarge(request.headers.get("Content-Length") ?? undefined)) {
    throw new FormBodyTooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) return Object.create(null) as Record<string, unknown>;

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > MAX_FORM_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FormBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (body.byteLength === 0) return Object.create(null) as Record<string, unknown>;

  const formData = await new Request(request, { body }).formData();
  const form: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of formData.entries()) {
    const existing = form[key];
    form[key] = existing === undefined
      ? value
      : Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
  }
  return form;
};

const setPrivateHtmlHeaders = (c: { header: (name: string, value: string) => void }) => {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "HX-Request");
};

const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
};

export const createApp = (options: AppOptions) => {
  const auth = createAuth(options);
  const app = new Hono<AuthEnv>();

  app.use("*", securityHeaders);

  app.get("/assets/app.css", () =>
    new Response(Bun.file(new URL("../public/app.css", import.meta.url)), {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "text/css; charset=UTF-8",
      },
    }),
  );

  app.get("/assets/app.js", () =>
    new Response(Bun.file(new URL("../public/app.js", import.meta.url)), {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "text/javascript; charset=UTF-8",
      },
    }),
  );

  app.get("/assets/htmx.min.js", () =>
    new Response(Bun.file(new URL("../node_modules/htmx.org/dist/htmx.min.js", import.meta.url)), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "text/javascript; charset=UTF-8",
      },
    }),
  );

  app.get("/", (c) => c.redirect("/repositories", 303));

  app.get("/login", (c) => {
    setPrivateHtmlHeaders(c);
    const identity = auth.authenticate(c);
    if (identity) return c.redirect("/repositories", 303);

    const returnTo = safeReturnTo(c.req.query("returnTo"));
    const csrfToken = auth.issueCsrf();
    return c.html(renderLoginPage({ csrfToken, returnTo }));
  });

  app.post("/login", async (c) => {
    setPrivateHtmlHeaders(c);

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed sign-in request", 400);
    }

    const returnTo = safeReturnTo(stringField(form.returnTo));
    const csrf = stringField(form.csrf);
    if (!auth.validateLogin(c, csrf)) {
      return c.text("Request rejected", 403);
    }

    const token = stringField(form.token) ?? "";
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !auth.matchesSharedToken(token)) {
      const nextCsrf = auth.issueCsrf();
      const content = renderLoginForm({
        csrfToken: nextCsrf,
        error: "The shared credential was not accepted.",
        returnTo,
      });

      if (isHtmx(c)) return c.html(content, 422);
      return c.html(renderLoginPage({ csrfToken: nextCsrf, error: "The shared credential was not accepted.", returnTo }), 422);
    }

    const session = auth.createSession();
    c.header("Set-Cookie", session.cookie);

    if (isHtmx(c)) {
      c.header("HX-Redirect", returnTo);
      return c.body(null, 200);
    }

    return c.redirect(returnTo, 303);
  });

  app.use("/repositories", auth.middleware);
  app.use("/repositories/*", auth.middleware);

  app.get("/repositories", (c) => {
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);
    return c.html(renderRepositoriesPage(csrfToken));
  });

  app.post("/logout", auth.middleware, async (c) => {
    setPrivateHtmlHeaders(c);
    const identity = c.get("auth");

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed sign-out request", 400);
    }

    if (!auth.validateBrowserMutation(c, identity, stringField(form.csrf))) {
      return c.text("Request rejected", 403);
    }

    auth.endSession(identity);
    c.header("Set-Cookie", auth.clearSessionCookie());

    if (isHtmx(c)) {
      c.header("HX-Redirect", "/login");
      return c.body(null, 200);
    }

    return c.redirect("/login", 303);
  });

  return app;
};

export type AtlasApp = ReturnType<typeof createApp>;
