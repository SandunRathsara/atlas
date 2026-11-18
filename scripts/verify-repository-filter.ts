import { strict as assert } from "node:assert";
import type { GitHubRepository } from "../src/github.ts";
import type { Repository } from "../src/persistence.ts";
import { renderAddRepositoryPage, renderRepositoriesPage, repositoryMatchesQuery } from "../src/views.ts";
import { pageTitle, repositoryPage, type RepositorySection } from "../src/views/shared.ts";

// The Repository page header as rendered by the shell: large title (with ⋯ menu) plus the intro.
const renderRepositoryHeading = (repository: Repository, section: RepositorySection, csrfToken: string) => {
  const page = repositoryPage(repository, section, csrfToken);
  return `${pageTitle(page.header)}${page.intro}`;
};

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
assert(listPage.includes('href="/repositories/1/specs"'), "Repository card links into the Repository");
assert(listPage.includes('href="/repositories/new"'), "Repositories list offers Add Repository");
assert(listPage.includes("Specs not read yet"), "No Spec count is invented before the first Specs read");

// Remove lives in the Repository header ⋯ menu and asks first: the real POST form sits inside a
// confirm-first <details data-confirm>, so opening the menu never submits it.
const heading = renderRepositoryHeading(enrolled, "pull-requests", "a");
const removeForm = formOpen(heading, "repository-action-1");
assert(!removeForm.includes('hx-target="none"'));
assert(removeForm.includes('hx-target="this"'));
assert(removeForm.includes('action="/repositories/1/remove"'));
const confirmStart = heading.indexOf("data-confirm");
assert(confirmStart >= 0 && confirmStart < heading.indexOf('<form id="repository-action-1"'), "Remove form must be inside the confirm");
assert(heading.includes("Nothing changes on GitHub"));
assert(heading.includes("history and existing Sessions are kept"));
assert(heading.match(/data-page-heading>HelloWorld<\/h1>/), "Repository name is the page h1");
assert(heading.includes('href="/repositories/1/pull-requests" aria-current="page"'), "active tab follows the section");
assert(renderRepositoryHeading(enrolled, "specs", "a").includes('href="/repositories/1/specs" aria-current="page"'));
assert(renderRepositoryHeading(enrolled, "sessions", "a").includes('href="/repositories/1/sessions" aria-current="page"'));
const removedHeading = renderRepositoryHeading({ ...enrolled, removedAt: "2026-01-02T00:00:00.000Z" }, "specs", "a");
const readdHeadingForm = formOpen(removedHeading, "repository-action-1");
assert(readdHeadingForm.includes('action="/repositories"'), "removed Repository offers Re-add through the enroll path");
assert(!removedHeading.includes("/remove"));
assert(!hxTargets(`${all}${readdPage}${listPage}${heading}${removedHeading}`).includes("none"));

console.log("repository filter ok");
