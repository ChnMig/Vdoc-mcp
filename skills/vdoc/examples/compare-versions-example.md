# Compare immutable commits

Resolve both branch/release references on the selected server, then keep the full returned commit IDs. Comparisons can cover unpublished commits, the same branch or different branches. Never compare moving branch labels or silently choose a different project.

```json
{
  "jsonrpc": "2.0",
  "id": "compare-commits-example",
  "method": "tools/call",
  "params": {
    "name": "compare_commits",
    "arguments": {
      "project_id": "project_returned_id",
      "from_commit_id": "full_baseline_commit_id_returned_by_server",
      "to_commit_id": "full_target_commit_id_returned_by_server"
    }
  }
}
```

Use returned old/new bytes and semantic evidence. Keep is_breaking and must_handle independent. A filtered comparison is incomplete for the full project; invalid semantic status does not prove compatibility. Cite the comparison direction and both immutable IDs.

Run AI analysis separately against these same IDs:

```json
{
  "jsonrpc": "2.0",
  "id": "analyze-commits-example",
  "method": "tools/call",
  "params": {
    "name": "analyze_changes",
    "arguments": {
      "project_id": "project_returned_id",
      "from_commit_id": "full_baseline_commit_id_returned_by_server",
      "to_commit_id": "full_target_commit_id_returned_by_server",
      "message": "Explain client changes supported by this comparison.",
      "language": "English"
    }
  }
}
```

Report the returned analysis ID/status, input commits and any truncated evidence. Failed/running output is not a successful analysis. Only a verified release establishes publication.

Legacy published versions can still use compare_api_versions/compare_doc_versions with exact legacy version IDs. A version_id is not a commit_id; resolve each namespace through its own tools.
