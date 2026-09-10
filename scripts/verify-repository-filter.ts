import { strict as assert } from "node:assert";
import type { GitHubRepository } from "../src/github.ts";
import type { Repository } from "../src/persistence.ts";
import { renderAddRepositoryPage, renderRepositoriesPage, repositoryMatchesQuery } from "../src/views.ts";

const repo = (overrides: Partial<GitHubRepository> = {}): GitHubRepository => ({
  id: "1",
  owner: "SandunRathsara",
  name: "HelloWorld",
  fullName: "SandunRathsara/HelloWorld",
  htmlUrl: "https://github.com/SandunRathsara/HelloWorld",
  description: "First GitHub project",
  visibility: "public",
  defaultBranch: "master",
  archived: false,
  disabled: false,
  hasIssues: true,
  ...overrides,
});

assert.equal(repositoryMatchesQuery(repo(), ""), true);
assert.equal(repositoryMatchesQuery(repo(), "  hello  "), true);
assert.equal(repositoryMatchesQuery(repo(), "HELLO"), true);
assert.equal(repositoryMatchesQuery(repo(), "SandunRathsara"), true);
assert.equal(repositoryMatchesQuery(repo(), "First GitHub"), true);
assert.equal(repositoryMatchesQuery(repo(), "nope"), false);

const available = [
  { repository: repo(), enrolled: false, csrfToken: "a" },
  {
    repository: repo({
      id: "2",
      name: "CSRF-Double-Submit-Cookie-Pattern",
      fullName: "SandunRathsara/CSRF-Double-Submit-Cookie-Pattern",
      description: "Web security",
    }),
    enrolled: false,
    csrfToken: "a",
  },
];

const filtered = renderAddRepositoryPage({ csrfToken: "a", available, query: "csrf" });
assert(filtered.includes("CSRF-Double-Submit-Cookie-Pattern"));
assert(!filtered.includes(">HelloWorld<"));
assert(filtered.includes('name="q"'));
assert(filtered.includes("Showing"));
assert(filtered.includes("tabular-nums\">1</span>"));
assert(filtered.includes("tabular-nums\">2</span>"));
assert(filtered.includes("Clear filter"));
assert(filtered.includes('id="repository-filter"'));

const empty = renderAddRepositoryPage({ csrfToken: "a", available, query: "zzzz" });
assert(empty.includes("No matching Repositories"));
assert(empty.includes("Clear filter"));

const all = renderAddRepositoryPage({ csrfToken: "a", available });
assert(all.includes(">HelloWorld<"));
assert(all.includes("CSRF-Double-Submit-Cookie-Pattern"));
assert(all.includes('name="q"'));
assert(!all.includes("Clear filter"));

const none = renderAddRepositoryPage({ csrfToken: "a", available: [] });
assert(none.includes("No Repositories available"));
assert(!none.includes('name="q"'));

const hxTargets = (html: string) => [...html.matchAll(/\bhx-target="([^"]*)"/g)].map((match) => match[1]);
const formOpen = (html: string, id: string) => {
  const match = html.match(new RegExp(`<form id="${id}"[^>]*>`));
  assert(match, `missing form ${id}`);
  return match[0];
};

const addForm = formOpen(all, "add-repository-1");
assert(
  !addForm.includes('hx-target="none"'),
  "Add Repository uses hx-target=none, which HTMX 2 reports as htmx:targetError, none and never POSTs",
);
assert(addForm.includes('hx-target="this"'), "Add Repository must target the form so HX-Redirect can run");
assert(addForm.includes('hx-swap="none"'));

const readdPage = renderAddRepositoryPage({
  csrfToken: "a",
  available: [{ repository: repo(), enrolled: true, removedAt: "2026-01-02T00:00:00.000Z", csrfToken: "a" }],
});
const readdForm = formOpen(readdPage, "add-repository-1");
assert(!readdForm.includes('hx-target="none"'));
assert(readdForm.includes('hx-target="this"'));

const enrolled: Repository = {
  githubId: "1",
  installationId: "1",
  organization: "SandunRathsara",
  owner: "SandunRathsara",
  name: "HelloWorld",
  fullName: "SandunRathsara/HelloWorld",
  htmlUrl: "https://github.com/SandunRathsara/HelloWorld",
  description: "First GitHub project",
  visibility: "public",
  defaultBranch: "master",
  archived: false,
  disabled: false,
  hasIssues: true,
  enrolledAt: "2026-01-01T00:00:00.000Z",
  removedAt: null,
  accessStatus: "available",
  accessReason: null,
};
const listPage = renderRepositoriesPage("a", [{ repository: enrolled }]);
const removeForm = formOpen(listPage, "repository-action-1");
assert(!removeForm.includes('hx-target="none"'));
assert(removeForm.includes('hx-target="this"'));
assert(!hxTargets(`${all}${readdPage}${listPage}`).includes("none"));

console.log("repository filter ok");
