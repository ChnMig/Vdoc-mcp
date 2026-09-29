# Draft actions and payloads

Read this reference when creating, updating, inspecting, or submitting a draft. Use the agent host's native MCP calls; JSON-RPC envelopes below are protocol examples only. All IDs are placeholders.

| User intent | Action |
| --- | --- |
| Create a proposed draft | Resolve the project, document and branch, then create once. Stop at the returned draft state. |
| Edit an existing draft | Read it by draft_id, preserve its branch and unchanged metadata, then update only if the content changes. |
| Submit for review | Submit the selected draft when this is part of the user's request. No extra confirmation is needed for an already authorized submission. |
| Inspect status | Use get_api_version_draft or get_doc_draft; do not mutate. |

Use list_document_branches to resolve the requested branch name even when the document has no published versions. Existing published versions are not a prerequisite for a first draft. Creating projects/documents/branches is an Admin action outside the MCP draft tools.

Draft updates require content and expected_revision from the draft snapshot used for editing, but do not accept branch_id. version_name, changelog, and source_git_commit_id are optional update fields; omit unchanged metadata. Never use a version name or branch name as an ID. Keep the revision returned by create, get, or update; send it as expected_revision on the next update. If FAILED_PRECONDITION is returned, reread and reconcile the current draft with local edits before retrying. Never substitute the latest revision and resend stale content blindly.

get_doc_draft returns Markdown content. In v0.2, get_api_version_draft returns metadata and revision at the top level and raw OpenAPI in content.content; content.hash matches raw_content_hash. Read the body and revision together before editing, and pass that revision as expected_revision. Do not treat get_latest_schema as the body of an unpublished draft. Older backends without draft content need an authorized local source file or an upgrade.

If a write times out, its outcome is unknown. When draft_id is known, read it before retrying an update or submission. An uncertain create without a returned ID cannot be recovered by a draft list tool in the current API: stop duplicate creates and report that the user should inspect Admin. Do not claim success from an attempted call.

## OpenAPI payloads


Use JSON-RPC `tools/call` requests with placeholder IDs and redacted schema content. Never include tokens or Authorization headers in examples or final output.

Create a draft:

```json
{
  "jsonrpc": "2.0",
  "id": "create-api-draft-example",
  "method": "tools/call",
  "params": {
    "name": "create_api_version_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "branch_id": "branch_placeholder",
      "version_name": "1.2.0",
      "changelog": "Describe the API contract changes for human review.",
      "source_git_commit_id": "commit_placeholder",
      "schema_content": "openapi: 3.1.0\ninfo:\n  title: Example API\n  version: 1.2.0\npaths: {}\n"
    }
  }
}
```

Update a draft:

```json
{
  "jsonrpc": "2.0",
  "id": "update-api-draft-example",
  "method": "tools/call",
  "params": {
    "name": "update_api_version_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "draft_id": "draft_placeholder",
      "expected_revision": "revision_from_read",
      "version_name": "1.2.0",
      "changelog": "Update the draft after local schema correction.",
      "source_git_commit_id": "commit_placeholder",
      "schema_content": "openapi: 3.1.0\ninfo:\n  title: Example API\n  version: 1.2.0\npaths: {}\n"
    }
  }
}
```

Submit a draft for review:

```json
{
  "jsonrpc": "2.0",
  "id": "submit-api-draft-example",
  "method": "tools/call",
  "params": {
    "name": "submit_api_version_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "draft_id": "draft_placeholder"
    }
  }
}
```

## Markdown Examples

Get latest Markdown content:

```json
{
  "jsonrpc": "2.0",
  "id": "latest-doc-example",
  "method": "tools/call",
  "params": {
    "name": "get_latest_doc",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "branch_id": "branch_dev"
    }
  }
}
```

Compare two Markdown versions:

```json
{
  "jsonrpc": "2.0",
  "id": "list-doc-versions-example",
  "method": "tools/call",
  "params": {
    "name": "list_doc_versions",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "compare-doc-example",
  "method": "tools/call",
  "params": {
    "name": "compare_doc_versions",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "from_version_id": "ver_placeholder_from",
      "to_version_id": "ver_placeholder_to"
    }
  }
}
```

Choose the payload matching the requested Markdown action; these are separate operations, not a mandatory sequence:

```json
{
  "jsonrpc": "2.0",
  "id": "create-doc-draft-example",
  "method": "tools/call",
  "params": {
    "name": "create_doc_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "branch_id": "branch_placeholder",
      "version_name": "1.2.0",
      "changelog": "Describe the Markdown update for human review.",
      "source_git_commit_id": "commit_placeholder",
      "markdown_content": "# Example\n\nUpdated Markdown content.\n"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "get-doc-draft-example",
  "method": "tools/call",
  "params": {
    "name": "get_doc_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "draft_id": "draft_placeholder"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "update-doc-draft-example",
  "method": "tools/call",
  "params": {
    "name": "update_doc_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "draft_id": "draft_placeholder",
      "expected_revision": "revision_from_read",
      "version_name": "1.2.0",
      "changelog": "Refine the Markdown draft after review.",
      "source_git_commit_id": "commit_placeholder",
      "markdown_content": "# Example\n\nRefined Markdown content.\n"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "submit-doc-draft-example",
  "method": "tools/call",
  "params": {
    "name": "submit_doc_draft",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "draft_id": "draft_placeholder"
    }
  }
}
```

After submission, state that the draft is waiting for human Admin/SuperAdmin review and that Vdoc creates a published immutable version only after that review path succeeds.
