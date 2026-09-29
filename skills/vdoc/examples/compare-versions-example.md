# Compare Versions Example

Use this workflow before migration advice or frontend impact analysis. The IDs below are placeholders; resolve real IDs with Vdoc MCP and never paste MCP tokens, JWTs, Authorization headers, or copied secret values into examples.

## Compare Two Published Versions

Resolve the requested branch names with `list_document_branches` and select the two versions from `list_api_versions` by `branch_id` and `version_name`. Report both branch/version selections, especially for a cross-branch comparison. Do not silently compare the newest entries across all branches.

```json
{
  "jsonrpc": "2.0",
  "id": "compare-versions-example",
  "method": "tools/call",
  "params": {
    "name": "compare_api_versions",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "from_version_id": "ver_placeholder_from",
      "to_version_id": "ver_placeholder_to"
    }
  }
}
```

Use the returned diff items as the source of truth. For each item, preserve fields such as `location`, `message`, `old_value`, `new_value`, `frontend_impact`, `is_breaking`, and `must_handle`.

## Get A Must-handle And Optional Summary

```json
{
  "jsonrpc": "2.0",
  "id": "change-summary-example",
  "method": "tools/call",
  "params": {
    "name": "get_change_summary",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "diff_id": "diff_placeholder"
    }
  }
}
```

Report required/breaking items first, then optional/non-breaking items. Preserve `must_handle` and `is_breaking` independently; a required fix is not automatically a breaking change.
