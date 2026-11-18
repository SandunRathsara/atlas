# Cutting an Atlas Release

Releases are made by one button: **Actions → Release → Run workflow** on `main`.
Or from a terminal:

```sh
gh workflow run release.yml --ref main -f bump=minor            # real
gh workflow run release.yml --ref main -f bump=minor -f dry_run=true
```

## Bumps

The next tag is computed from the published GitHub Releases. The build number
is global: highest published build + 1.

| bump | from `v1.4.2+build.12` | use for |
|---|---|---|
| `patch` | `v1.4.3+build.13` | fixes |
| `minor` | `v1.5.0+build.13` | features |
| `major` | `v2.0.0+build.13` | breaking changes |
| `build` | `v1.4.2+build.13` | same behavior, rebuilt (e.g. OpenCode client bump) |

With no Releases yet, only `minor` is accepted and gives `v0.1.0+build.1`.

## Who may release

Logins listed in `RELEASERS` at the top of `.github/workflows/release.yml`.
Both the person who started the run and the person who re-ran it must be listed.
To add someone, add their login there (space-separated) in a reviewed PR to `main`.

## What each job may do

| job | token | runs repo code | does |
|---|---|---|---|
| plan | read | `scripts/release.ts` only | allowlist, `main` only, next tag, pins the `main` SHA |
| gate | read | yes | `check.yml` full tier on that SHA |
| build | read | yes | builds and smoke-tests the 4 files, uploads them with a SHA-256 digest |
| publish | **write** | **no** (no checkout) | re-checks the digest and checksum, then creates tag + Release in one `gh release create` |

If gate or build fails, nothing is tagged or published. Runs never overlap.

## Dry run

`dry_run=true` does everything except create the tag and Release; the publish
log lists what it would publish. Any run not on `main` is refused.

## When a release fails half-way

Releases are immutable: never re-upload assets, never move or reuse a tag.

- **Failed before publish** (plan, gate, build): nothing was created. Fix on
  `main` and run again.
- **Publish failed, no tag and no Release:** re-run the failed job. The same tag
  is still free.
- **A draft Release exists, no tag** (asset upload broke): delete the draft
  (`gh release delete '<tag>'`), then re-run publish.
- **Tag exists but no Release:** plan refuses this tag. Check the tag points at
  the pinned SHA (`gh api 'repos/SandunRathsara/atlas/git/ref/tags/<tag with + as %2B>'`).
  Since nothing was published, it is safe to delete that tag
  (`git push origin ':refs/tags/<tag>'`) and run again.
- **Release published but something is wrong:** leave it. Fix on `main` and
  cut a new release (a `build` bump if behavior is unchanged).
