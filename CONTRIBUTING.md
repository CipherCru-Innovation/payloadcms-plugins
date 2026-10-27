# Contributing

## Setup

Node 22.13 or later, and npm.

```sh
npm ci
npm run lint && npm run typecheck && npm test && npm run build
```

Each plugin lives in `packages/<name>/` and is an npm workspace. `npm test -w packages/<name>`
runs one plugin's suite. `npm run check:packages` packs every plugin and lints what would be
published (`publint`, `attw`).

## Changes and releases

Every pull request that changes a published package carries a changeset:

```sh
npx changeset
```

Pick the packages, the bump (patch, minor, major) and write one line for the changelog. A
change that should not release, such as a test or a README fix, uses `npx changeset --empty`.
CI fails a pull request that changes a package without one.

On `main`, the Release workflow collects the changesets into a "Version Packages" pull
request. Merging it publishes the bumped packages to npm through trusted publishing, tags
them `<name>@<version>` and creates their GitHub releases. Nobody publishes from a laptop
except a package's very first version (below).

Before 1.0, a breaking change bumps the minor version. What a plugin stores (collection and
global slugs, field names) is part of its public API, since a host may read it directly.

## Commits and issues

Issues are filed and closed here on GitHub. A YouTrack project mirrors them one way for
CipherCru's own planning, so edit an issue here, not there. Reference the issue in the pull
request or commit that resolves it: `Fixes #12`.

## Adding a plugin

1. Create `packages/<name>/` with a `package.json` named `@ciphercru/payload-<name>`,
   following `packages/analytics`: `exports` into `dist/`, Payload as a peer,
   `publishConfig.access` public, the `prepack`, `check`, `typecheck` and `test` scripts,
   and a copy of `LICENSE`.
2. Add `<name>` to the Plugin dropdown in both `.github/ISSUE_TEMPLATE/*.yml` forms, a row to
   the README table, and the value to the Plugin field of the YouTrack project.
3. Publish its first version by hand, since npm can only trust a workflow for a package that
   already exists: `npm publish -w packages/<name>` with your 2FA code, then
   `git tag @ciphercru/payload-<name>@<version> && git push --tags`.
4. On npmjs.com, in the package's settings, add a trusted publisher: GitHub Actions,
   organization `CipherCru-Innovation`, repository `payloadcms-plugins`, workflow
   `release.yml`, environment `npm`, spelled exactly as GitHub shows them. Then set publishing
   access to require 2FA and disallow tokens.
