<p>
  <img src="assets/vdoc-logo.png" width="96" height="96" alt="Vdoc logo" />
</p>

# Vdoc Skill

The optional Vdoc Skill teaches agents how to read exact OpenAPI/Markdown/TXT commits, compare immutable revisions, atomically commit changes, analyze them and propose human review. The server generates commit identities and release versions. Vdoc MCP provides the tools and facts; the Skill does not store data or credentials or call the backend directly. MCP also works without this Skill.

The Skill is maintained in `Vdoc-mcp/skills/vdoc` and ships inside the same `@vdoc/mcp` package as the adapter. There is one version, test suite, and release. The former Vdoc-skill repository is no longer required.

## Install and update with MCP

For environments that follow an update channel, use the [release/beta channel installer](https://github.com/ChnMig/Vdoc-mcp#channel-installs-release-or-beta). It keeps prebuilt MCP + Skill packages in separate persistent prefixes. Use the command printed for that channel and link its Skill into the corresponding project or agent scope:

```sh
# Run from the beta test project, separate from your stable project.
"$HOME/.local/share/vdoc/mcp/beta/node_modules/.bin/vdoc-mcp" skill install --directory .agents/skills/vdoc
```

Repeat the beta installer command to update only beta; use the release installer for stable updates. Each link exposes the matching package's new Skill automatically. Both Skills are named `vdoc`, so keep beta and stable links in separate scopes. Do not install a beta Skill over the stable Skill or point beta MCP at the stable backend. Reload the agent and restart MCP after updating. No registry publication or background update is implied.

For an explicitly pinned workspace version:

First download and verify the [workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment). Follow the [combined package installation](https://github.com/ChnMig/Vdoc-mcp#optional-skill-and-linked-updates) to download the release selected by its lock, check `SHA256SUMS`, install the prebuilt archive globally, and run `vdoc-mcp skill install`. The archive avoids npm's global Git preparation failure (`tsc: command not found`).

The default target is `$HOME/.agents/skills/vdoc`. For a different agent or project scope, pass its skill directory explicitly:

```sh
vdoc-mcp skill install --directory "$HOME/.claude/skills/vdoc"
vdoc-mcp skill install --directory .agents/skills/vdoc
```

The installer creates a directory link and refuses to overwrite an existing, separately managed Skill. Preserve any local edits and move the old installation before migrating. Do not let multiple installers manage the same destination.

To update, install the verified MCP release archive selected by the newer reviewed lock globally at the same npm prefix. The link then exposes the new Skill, including its references and templates, automatically. Reload the agent and restart its MCP process. A change of npm prefix or Node installation requires relinking; `npx` cache directories are unsuitable for a persistent link.

The package is not on the npm registry yet. `npm update --global @vdoc/mcp` becomes applicable only after registry publication and migration to a registry installation. Git-pinned installations continue to require an explicit new commit. No install lifecycle hook writes into agent directories.

## Install before connecting MCP

Use Vdoc's channel installer above to install or update the combined MCP + Skill package. Package installation and Skill linking need no backend URL or token. Preserve existing MCP client settings; configure the selected environment's connection separately before using its tools. For updates, reuse the same channel and prefix, restart MCP, and reload the agent.

## Contents and validation

- [Workflow instructions](SKILL.md)
- [Commit workflows](references/commit-workflows.md)
- [Legacy draft compatibility](references/draft-workflows.md)
- [Tool contract](references/mcp-tools.json)
- [Endpoint integration template](templates/endpoint-integration.md)
- [Change summary template](templates/frontend-change-summary.md)
- [Behavior evaluation cases](evals/cases.md)

From the Vdoc-mcp repository root, run `npm test` for both MCP and Skill validation. `npm run release:package -- vMAJOR.MINOR.PATCH` produces one package containing both. Static checks validate the tool inventory, arguments, links, and package contents; they do not establish model behavior.

Never put MCP tokens, JWTs, database passwords, or storage secrets into Skill files. Configure credentials through the MCP client. Draft publication remains a human review action enforced by the backend.
