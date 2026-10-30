# Immutable commit actions and payloads

Use runtime tool schemas. These protocol examples contain placeholder IDs; replace them only with IDs returned from the selected environment. The server generates revision identities and release version names. The request's idempotency key is an opaque retry key, not a version number.

## Pin a branch

Resolve the project with list_projects and branch with list_branches, then pin its exact head and generation:

```json
{
  "jsonrpc": "2.0",
  "id": "pin-branch",
  "method": "tools/call",
  "params": {
    "name": "resolve_ref",
    "arguments": {
      "project_id": "project_returned_id",
      "branch_id": "branch_returned_id"
    }
  }
}
```

Read each changed file with get_document_at_commit using the returned commit ID. Keep existing document IDs stable when renaming; new documents omit the ID and receive one from the server.

## Save an atomic commit

The generation below is illustrative: use the integer actually returned with the branch. No client revision or version_name field exists.

```json
{
  "jsonrpc": "2.0",
  "id": "commit-document-change",
  "method": "tools/call",
  "params": {
    "name": "commit_changes",
    "arguments": {
      "project_id": "project_returned_id",
      "branch_id": "branch_returned_id",
      "expected_head_commit_id": "full_commit_id_returned_by_resolve_ref",
      "expected_generation": 7,
      "idempotency_key": "opaque_request_key_reused_for_exact_retries",
      "message": "Clarify the retry policy",
      "changes": [
        {
          "operation": "upsert",
          "document_id": "existing_document_returned_id",
          "relative_path": "guides/retries.md",
          "name": "Retry policy",
          "document_type": 2,
          "content": "# Retry policy\n\nRetry only idempotent requests.\n"
        },
        {
          "operation": "upsert",
          "relative_path": "notes/empty.txt",
          "name": "Empty note",
          "document_type": 3,
          "content": ""
        }
      ]
    }
  }
}
```

All changes succeed together or none do. LEGACY_IMPORT_REQUIRED means old snapshots must first be imported by a human Admin in the workbench; do not bypass it with a replacement branch or legacy draft writes. Deleting a file uses {"operation":"delete","document_id":"existing_document_returned_id"}; the old bytes remain in earlier commits. Deletion scope comes from the historical file type, not a client-supplied type. Read the returned immutable commit to verify the final bytes and IDs.

If another writer advanced the branch, reconcile against the new head before creating a new request. If the outcome is unknown because the connection failed, resend the **identical payload and idempotency key**. A reused key with a changed payload is a conflict. Never make up a successful commit ID or report publication after a save.

## Propose review

Only when requested, create a merge request. Its returned source/target heads and generations bind the review; new changes require a fresh review. Human approval/publication happens in the workbench.

```json
{
  "jsonrpc": "2.0",
  "id": "propose-merge",
  "method": "tools/call",
  "params": {
    "name": "create_merge_request",
    "arguments": {
      "project_id": "project_returned_id",
      "source_branch_id": "source_branch_returned_id",
      "target_branch_id": "target_branch_returned_id",
      "title": "Review retry documentation"
    }
  }
}
```

For the published result, read list_releases and resolve the exact returned release_id. Release IDs and generated version names are separate from branch labels and commit IDs.
