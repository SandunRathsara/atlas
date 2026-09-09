import { strict as assert } from "node:assert";
import type { GitHubRepository } from "../src/github.ts";
import { renderAddRepositoryPage, repositoryMatchesQuery } from "../src/views.ts";

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
assert(filtered.includes("Showing 1 of 2 Repositories"));
assert(filtered.includes("Clear filter"));

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

console.log("repository filter ok");
