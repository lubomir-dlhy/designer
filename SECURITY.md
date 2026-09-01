# Security policy

## Reporting

Please report vulnerabilities through GitHub's private security-advisory flow
instead of opening a public issue. Do not include credentials, Claude session
cookies, debug-profile contents, or private design URLs in reports or logs.

## Supply-chain controls

- Direct dependencies, Bun, agent-browser, Chrome for Testing, Node, npm, and
  the clean-room Docker image are pinned to reviewed immutable versions.
- `bun.lock` authenticates the complete transitive graph with registry
  integrity hashes, and CI installs it only through `bun ci`.
- Dependency lifecycle scripts are disabled. New registry versions must age for
  at least seven days before Bun will resolve them.
- Dependency and GitHub Actions updates are separate, human-reviewed PRs. CI
  performs vulnerability, license, untrusted-script, and dependency-diff checks.
- Every external GitHub Action is pinned to a full commit SHA. Hosted runner
  images use a fixed OS release rather than `*-latest`.
- npm publishing uses OIDC trusted publishing and provenance; there is no
  long-lived npm publishing token in the workflow.

## Updating a pin

Use a dedicated dependency PR. Review the publisher, release notes, publish
date, integrity/lockfile diff, install scripts, transitive additions, licenses,
and GitHub Action commit ownership. Run `bun run security:audit`, `bun test`,
and the clean-room smoke test before merging. Never weaken a pin to `latest`, a
tag-only GitHub Action reference, or a semver range.
