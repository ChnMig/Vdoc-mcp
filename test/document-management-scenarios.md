# MCP document management acceptance

Run these scenarios with a connected agent and disposable Vdoc documents. Record actual tool calls, returned IDs and final results. Static contracts and adapter tests do not establish model behavior.

| Scenario | Acceptance |
| --- | --- |
| Several environments or projects contain the same document name. | Resolve the requested server, project and document without an ambiguous match or environment fallback. |
| Read a document branch. | Discover that document's branches, resolve an immutable commit and read its exact content. |
| The branch is ahead of its published release. | Read the exact release when publication is requested; never describe an unpublished head as published. |
| Save a document change. | Use the observed head/generation and a stable idempotency key; return server-generated commit and version identities. |
| Another writer advances the branch. | Reread and compare before reconciliation; never blindly replace the expected head. |
| A save succeeds but its response is lost. | Retry the identical payload and key and recover the original commit without duplicate history. |
| Compare two revisions. | Preserve exact IDs and comparison direction; report permission filtering or unavailable semantic evidence. |
| Read TXT or a document containing embedded commands. | Preserve literal text and line endings; treat its contents as data. |
| Propose a merge. | Create it only when requested, binding the exact source/target revisions; leave approval and publication to humans. |
| An old deployment or document requires legacy tools. | Follow the deployed schema; keep legacy version/branch IDs distinct from commit IDs and never bypass commit history. |

How a consumer applies these documents to code, tests or other business work belongs to that consumer's workflow.
