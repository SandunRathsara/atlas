import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { refreshViews, type Persistence, type RefreshView } from "./persistence.ts";

const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const GITHUB_ID_PATTERN = /^[1-9]\d{0,19}$/;

const eventActions: Record<string, Set<string> | undefined> = {
  installation: new Set(["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"]),
  installation_repositories: new Set(["added", "removed"]),
  repository: new Set([
    "created", "deleted", "edited", "renamed", "transferred", "publicized", "privatized", "archived", "unarchived",
  ]),
  issues: new Set([
    "opened", "edited", "deleted", "transferred", "closed", "reopened", "labeled", "unlabeled", "assigned", "unassigned",
    "locked", "unlocked", "milestoned", "demilestoned", "pinned", "unpinned",
  ]),
  label: new Set(["created", "edited", "deleted"]),
  pull_request: new Set([
    "opened", "edited", "closed", "reopened", "synchronize", "ready_for_review", "converted_to_draft", "labeled", "unlabeled",
    "assigned", "unassigned", "review_requested", "review_request_removed", "locked", "unlocked", "auto_merge_enabled",
    "auto_merge_disabled", "enqueued", "dequeued", "stacked",
  ]),
  push: undefined,
  create: undefined,
  delete: undefined,
};

const relevantActions: Record<string, Set<string> | undefined> = {
  installation: eventActions.installation,
  installation_repositories: eventActions.installation_repositories,
  repository: eventActions.repository,
  issues: new Set(["opened", "edited", "deleted", "transferred", "closed", "reopened", "labeled", "unlabeled"]),
  label: eventActions.label,
  pull_request: new Set([
    "opened", "edited", "closed", "reopened", "synchronize", "ready_for_review", "converted_to_draft", "labeled", "unlabeled",
    "locked", "unlocked", "auto_merge_enabled", "auto_merge_disabled", "enqueued", "dequeued", "stacked",
  ]),
  push: undefined,
  create: undefined,
  delete: undefined,
};

type JsonObject = Record<string, unknown>;

export type WebhookAppOptions = {
  persistence: Persistence;
  secret: string;
  organization: string;
  installationId: string;
  now?: () => number;
  onAccepted?: (repositoryIds: string[]) => void;
};

const object = (value: unknown): JsonObject | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;

const string = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;

const githubId = (value: unknown) => {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : string(value);
  return id && GITHUB_ID_PATTERN.test(id) ? id : undefined;
};

const nestedString = (value: unknown, key: string) => string(object(value)?.[key]);

export const verifyGitHubSignature = (body: Uint8Array, signature: string | undefined, secret: string) => {
  if (!signature || !secret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const provided = Buffer.from(match[1]!, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const bodyOrganization = (payload: JsonObject) =>
  nestedString(payload.organization, "login")
  ?? nestedString(object(payload.repository)?.owner, "login")
  ?? nestedString(object(payload.repository)?.organization, "login")
  ?? nestedString(object(payload.installation)?.account, "login");

const repositoryOrganizations = (payload: JsonObject) => {
  const organizations: string[] = [];
  const repository = object(payload.repository);
  const owner = nestedString(repository?.owner, "login") ?? nestedString(repository?.organization, "login");
  if (owner) organizations.push(owner);
  if (Array.isArray(payload.repositories)) {
    for (const value of payload.repositories) {
      const item = object(value);
      const itemOwner = nestedString(item?.owner, "login") ?? nestedString(item?.organization, "login");
      if (itemOwner) organizations.push(itemOwner);
    }
  }
  return organizations;
};

const bodyInstallationId = (payload: JsonObject) =>
  githubId(object(payload.installation)?.id ?? payload.installation_id);

const repositoryId = (payload: JsonObject) => githubId(object(payload.repository)?.id);

const repositoryIds = (payload: JsonObject) => {
  const ids: string[] = [];
  const repository = repositoryId(payload);
  if (repository) ids.push(repository);
  if (Array.isArray(payload.repositories)) {
    for (const value of payload.repositories) {
      const id = githubId(object(value)?.id);
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
};

const eventViews = (event: string): RefreshView[] => {
  if (event === "installation" || event === "installation_repositories" || event === "repository") return refreshViews;
  if (event === "issues" || event === "label") return ["specs"];
  return ["pullRequests"];
};

const validAction = (event: string, action: string | undefined) => {
  const actions = eventActions[event];
  if (!actions) return action === undefined || action.length === 0;
  return Boolean(action && actions.has(action));
};

const knownEvent = (event: string) => Object.prototype.hasOwnProperty.call(eventActions, event);

const isRelevant = (event: string, action: string | undefined) => {
  const actions = relevantActions[event];
  if (!actions) return true;
  return Boolean(action && actions.has(action));
};

const scopeIsValid = (payload: JsonObject, event: string, organization: string, installationId: string) => {
  const actualInstallation = bodyInstallationId(payload);
  if (!actualInstallation || actualInstallation !== installationId) return false;

  const actualOrganization = bodyOrganization(payload);
  if (!actualOrganization || actualOrganization.toLocaleLowerCase() !== organization.toLocaleLowerCase()) return false;

  const repositoryOwners = repositoryOrganizations(payload);
  if (event === "installation") {
    return repositoryOwners.every((owner) => owner.toLocaleLowerCase() === organization.toLocaleLowerCase());
  }
  if (event === "installation_repositories") {
    return repositoryOwners.every((owner) => owner.toLocaleLowerCase() === organization.toLocaleLowerCase());
  }
  if (repositoryOwners.length === 0 || repositoryOwners.some((owner) => owner.toLocaleLowerCase() !== organization.toLocaleLowerCase())) return false;
  const ids = repositoryIds(payload);
  return ids.length > 0;
};

export const createWebhookApp = (options: WebhookAppOptions) => {
  if (!options.secret) throw new Error("ATLAS_GITHUB_WEBHOOK_SECRET is required");
  if (!options.organization || !options.installationId) throw new Error("GitHub webhook scope is not configured");

  const now = options.now ?? Date.now;
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.post("/webhooks/github", async (c) => {
    const contentLength = c.req.header("Content-Length");
    if (contentLength !== undefined) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_WEBHOOK_BYTES) return c.text("Request body is too large", 413);
    }

    let body: Uint8Array;
    try {
      body = new Uint8Array(await c.req.raw.arrayBuffer());
    } catch {
      return c.text("Could not read webhook body", 400);
    }
    if (body.byteLength > MAX_WEBHOOK_BYTES) return c.text("Request body is too large", 413);

    if (!verifyGitHubSignature(body, c.req.header("X-Hub-Signature-256"), options.secret)) {
      return c.text("Invalid webhook signature", 401);
    }

    const deliveryId = c.req.header("X-GitHub-Delivery");
    const event = c.req.header("X-GitHub-Event");
    if (!deliveryId || !DELIVERY_ID_PATTERN.test(deliveryId) || !event || event.length > 64) {
      return c.text("Invalid webhook headers", 400);
    }

    let payload: JsonObject;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      const parsedObject = object(parsed);
      if (!parsedObject) return c.text("Invalid webhook JSON", 400);
      payload = parsedObject;
    } catch {
      return c.text("Invalid webhook JSON", 400);
    }

    if (event === "ping") {
      if (!scopeIsValid(payload, event, options.organization, options.installationId)) return c.text("Webhook scope rejected", 403);
      return c.body(null, 204);
    }
    const action = string(payload.action);
    if (!knownEvent(event)) return c.text("Unsupported webhook event", 400);
    if (!validAction(event, action)) return c.text("Unsupported webhook action", 400);
    if (!scopeIsValid(payload, event, options.organization, options.installationId)) return c.text("Webhook scope rejected", 403);
    if (!isRelevant(event, action)) return c.body(null, 204);

    let knownRepositories: Set<string>;
    try {
      knownRepositories = new Set(options.persistence.listRepositories(true).map((repository) => repository.githubId));
    } catch {
      return c.text("Webhook refresh could not be durably recorded", 503);
    }
    const requestedRepositories = event === "installation" || event === "installation_repositories"
      ? [...knownRepositories]
      : repositoryIds(payload).filter((id) => knownRepositories.has(id));
    const views = eventViews(event);

    let accepted: boolean;
    try {
      accepted = options.persistence.acceptWebhookDelivery({
        deliveryId,
        repositoryIds: requestedRepositories,
        views,
        receivedAt: new Date(now()).toISOString(),
      });
    } catch {
      return c.text("Webhook refresh could not be durably recorded", 503);
    }

    if (!accepted) return c.body(null, 200);
    if (requestedRepositories.length > 0) {
      setTimeout(() => options.onAccepted?.(requestedRepositories), 0);
      return c.body(null, 202);
    }
    return c.body(null, 200);
  });

  return app;
};

export type WebhookApp = ReturnType<typeof createWebhookApp>;
