const INBOX_COOKIE = "atlas_inbox";
const VISIT_COOKIE = "atlas_visit";
const FLAGS = "Path=/; Secure; HttpOnly; SameSite=Strict";

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

const parseObject = (raw: string | undefined) => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const optionalString = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);

const serialize = (name: string, value: object) =>
  `${name}=${encodeURIComponent(JSON.stringify(value))}; ${FLAGS}`;

export const readInboxCookie = (header: string | undefined) => {
  const repositoryId = optionalString(parseObject(getCookie(header, INBOX_COOKIE)).repositoryId);
  return repositoryId ? { repositoryId } : {};
};

export const readVisitCookie = (header: string | undefined) => {
  const parsed = parseObject(getCookie(header, VISIT_COOKIE));
  return {
    lastVisitAt: optionalString(parsed.lastVisitAt),
    lastRepositoryId: optionalString(parsed.lastRepositoryId),
  };
};

export const inboxCookie = (repositoryId?: string) =>
  serialize(INBOX_COOKIE, repositoryId ? { repositoryId } : {});

export const visitCookie = (lastVisitAt: string, lastRepositoryId?: string) =>
  serialize(VISIT_COOKIE, lastRepositoryId ? { lastVisitAt, lastRepositoryId } : { lastVisitAt });
