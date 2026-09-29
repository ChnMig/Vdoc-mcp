<p>
  <img src="assets/vdoc-logo.png" width="96" height="96" alt="Vdoc logo" />
</p>

# Vdoc Skill

The optional Vdoc Skill teaches agents how to query API contracts and Markdown documents, compare versions, and prepare drafts for human review. Vdoc MCP provides the tools and facts; the Skill does not store data or credentials or call the backend directly. MCP also works without this Skill.

The Skill is maintained in `Vdoc-mcp/skills/vdoc` and ships inside the same `@vdoc/mcp` package as the adapter. There is one version, test suite, and release. The former Vdoc-skill repository is no longer required.

## Install and update with MCP

First download and verify the [workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment). From its extracted directory, install the MCP commit pinned by its lock, then link the bundled Skill into your agent:

```sh
VDOC_WORKSPACE_LOCK="${VDOC_WORKSPACE_LOCK:-./workspace.lock.json}"
VDOC_MCP_COMMIT="$(jq -er '.repositories[] | select(.path == "Vdoc-mcp") | .commit' "$VDOC_WORKSPACE_LOCK")"
printf '%s' "$VDOC_MCP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
npm install --global "git+https://github.com/ChnMig/Vdoc-mcp.git#$VDOC_MCP_COMMIT"
vdoc-mcp skill install
```

The default target is `$HOME/.agents/skills/vdoc`. For a different agent or project scope, pass its skill directory explicitly:

```sh
vdoc-mcp skill install --directory "$HOME/.claude/skills/vdoc"
vdoc-mcp skill install --directory .agents/skills/vdoc
```

The installer creates a directory link and refuses to overwrite an existing, separately managed Skill. Preserve any local edits and move the old installation before migrating. Do not use both this installer and Skills CLI to manage the same destination.

To update, install the MCP commit from the newer reviewed lock, or install its verified release archive globally at the same npm prefix. The link then exposes the new Skill, including its references and templates, automatically. Reload the agent and restart its MCP process. A change of npm prefix or Node installation requires relinking; `npx` cache directories are unsuitable for a persistent link.

The package is not on the npm registry yet. `npm update --global @vdoc/mcp` becomes applicable only after registry publication and migration to a registry installation. Git-pinned installations continue to require an explicit new commit. No install lifecycle hook writes into agent directories.

## Install only the Skill

Skills CLI can discover this directory in the combined repository:

```sh
npx skills add ChnMig/Vdoc-mcp --skill vdoc -g
```

That command follows the repository's default branch. To use a reviewed version instead, pass `https://github.com/ChnMig/Vdoc-mcp/tree/<VDOC_MCP_COMMIT>/skills/vdoc` with the commit from the workspace lock. Skills CLI owns updates for this independent installation; updating the MCP npm package will not replace it. Configure MCP separately before using the workflows.

## Contents and validation

- [Workflow instructions](SKILL.md)
- [Draft workflows](references/draft-workflows.md)
- [Tool contract](references/mcp-tools.json)
- [Endpoint integration template](templates/endpoint-integration.md)
- [Change summary template](templates/frontend-change-summary.md)
- [Behavior evaluation cases](evals/cases.md)

From the Vdoc-mcp repository root, run `npm test` for both MCP and Skill validation. `npm run release:package -- vMAJOR.MINOR.PATCH` produces one package containing both. Static checks validate the tool inventory, arguments, links, and package contents; they do not establish model behavior.

Never put MCP tokens, JWTs, database passwords, or storage secrets into Skill files. Configure credentials through the MCP client. Draft publication remains a human review action enforced by the backend.
