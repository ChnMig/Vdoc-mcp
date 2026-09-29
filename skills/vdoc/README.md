<p>
  <img src="assets/vdoc-logo.png" width="96" height="96" alt="Vdoc logo" />
</p>

# Vdoc Skill

Vdoc Skill is the installable agent workflow package for Vdoc. It teaches AI agents when and how to use Vdoc MCP for API contract facts, Markdown document facts, endpoint integration, migration analysis, and draft submission.

The skill does not store data, compute diffs, or talk to Vdoc directly. Vdoc MCP is the source of truth for tools and facts.

## Contents

```text
SKILL.md
references/
  draft-workflows.md
  mcp-tools.json
templates/
  endpoint-integration.md
  frontend-change-summary.md
examples/
  endpoint-query-example.md
  compare-versions-example.md
```

## Install

First [download and verify the Compose workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment). Its [source lock](https://github.com/ChnMig/Vdoc-site/blob/main/workspace/workspace.lock.json) is also browsable in Vdoc-site. Run the installation commands below from the extracted `vdoc-workspace` directory, or set `VDOC_WORKSPACE_LOCK` to its absolute lock path.

Install the exact commit pinned by the workspace release lock into the standard
agent skill directory, with `SKILL.md` at the `vdoc` skill root:

```sh
# Personal installation; use .agents/skills/vdoc for repository scope instead.
VDOC_SKILL_DIR="$HOME/.agents/skills/vdoc"
VDOC_WORKSPACE_LOCK="${VDOC_WORKSPACE_LOCK:-./workspace.lock.json}"
VDOC_SKILL_COMMIT="$(jq -er '.repositories[] | select(.path == "Vdoc-skill") | .commit' "$VDOC_WORKSPACE_LOCK")"
printf '%s' "$VDOC_SKILL_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
test ! -e "$VDOC_SKILL_DIR"
mkdir -p "$(dirname -- "$VDOC_SKILL_DIR")"
git init "$VDOC_SKILL_DIR"
git -C "$VDOC_SKILL_DIR" remote add origin https://github.com/ChnMig/Vdoc-skill.git
git -C "$VDOC_SKILL_DIR" fetch --depth 1 origin "$VDOC_SKILL_COMMIT"
git -C "$VDOC_SKILL_DIR" checkout --detach FETCH_HEAD
test "$(git -C "$VDOC_SKILL_DIR" rev-parse HEAD)" = "$VDOC_SKILL_COMMIT"
test -f "$VDOC_SKILL_DIR/SKILL.md"
```

The command derives its commit from the external reviewed lock so this
repository does not make an impossible self-referential claim about its own
future commit. The reviewed lock is distributed in the checksummed
[Vdoc-site Docker Compose workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment);
verify its `.sha256` file before running the workspace initializer. If the
target already exists, verify its current `HEAD`; upgrade only by fetching and
checking out the commit from a newer reviewed lock. Do not use an unpinned
`git pull` for an installed Skill.

The current Skill uses `list_document_branches` and `list_api_endpoints` when the backend exposes them. Upgrade Backend together with Skill for complete ID discovery; older release locks may not include those tools. The skill falls back to exact user-provided IDs instead of guessing.

Pair it with the [Vdoc MCP adapter](https://github.com/ChnMig/Vdoc-mcp); the skill describes the workflow, while MCP provides the tools.

## Local Vdoc Closure Path

For a local Vdoc backend, Admin, MCP adapter, and Skill check that match the workspace docs, run from the workspace root:

```sh
scripts/vdoc-local-bootstrap.sh
docker compose --env-file .env up -d --build
cd Vdoc && go run ./tools/vdoc-demo-seed
```

The demo seed is optional. To verify live backend behavior against the root Compose stack:

```sh
cd Vdoc
./scripts/vdoc-e2e.sh live-compose --env-file ../.env --check-only
./scripts/vdoc-e2e.sh live-compose --env-file ../.env
```

Live E2E resets the selected disposable `VDOC_TEST_POSTGRES_DB`, `vdoc_e2e` by default. It does not reset the application database from `VDOC_POSTGRES_DB`.

Use the root release dry-run as the local gate before distributing the skill:

```sh
scripts/vdoc-release-dry-run.sh --list
scripts/vdoc-release-dry-run.sh
```

The dry-run does not publish packages or deploy services.

## Safety Rules

- Vdoc MCP is the source of truth for API contract facts and Markdown document content.
- Do not infer endpoint fields, parameters, response properties, enum values, auth schemes, servers, breaking-change claims, or Markdown text.
- Never print, copy, or log MCP tokens or JWTs.
- Never expose raw JWTs, MCP tokens, DB passwords, storage secrets, or `Authorization` header values in examples, logs, screenshots, issues, or final output.
- Direct publish tools are unavailable in v0.1; human Admin/SuperAdmin review publishes versions.

## Automated Releases

For a new version, update `package.json` and `package-lock.json` together with `npm version 0.1.1 --no-git-tag-version` (substitute the intended version), commit the changes, and push the matching `v0.1.1` tag. CI requires the tag to match both manifests, runs the existing checks, and creates a [GitHub Release](https://github.com/ChnMig/Vdoc-skill/releases) containing `vdoc-skill-<version>.tgz` and `SHA256SUMS`. A tag such as `v0.1.1-rc.1` creates a prerelease; ordinary branch pushes and pull requests run checks only. Existing releases are not overwritten.

For local packaging, run `npm run release:package -- v0.3.0` with the version in the manifests. Output stays in the ignored `.artifacts/release/` directory. The workflow uploads the installable package to GitHub Releases; npm registry publication remains separate.

After downloading a release matching the reviewed workspace lock and verifying `SHA256SUMS`, extract its `package/` contents into a new Skill directory with `--strip-components=1`, so `SKILL.md` is directly at the `vdoc` skill root. The archive includes references, templates, examples, and evaluation cases.

## Validate

```sh
npm test
```

`npm test` validates packaged references and example arguments. [Behavior evaluation cases](evals/cases.md) cover real agent decisions and should be run in an isolated fixture workspace when evaluating a model; static checks do not establish model behavior.
