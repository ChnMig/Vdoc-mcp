# Frontend Change Summary Template

Use this template after `compare_commits` and its returned OpenAPI semantic evidence. Exact legacy versions may use `compare_api_versions` and optional `get_change_summary`. Do not fill contract facts from memory or source code alone.

## Source

- Project: `{{project_id_or_name}}`
- Document: `{{document_id_or_name}}`
- Branches: `{{from_branch_id_or_name}}` → `{{to_branch_id_or_name}}`
- From immutable commit: `{{from_commit_id}}`
- To immutable commit: `{{to_commit_id}}`
- Verified release/publication state, if known: `{{release_id_or_unpublished}}`
- MCP calls used: `compare_commits` `{{comparison_id}}`; cite exact legacy version IDs separately when using legacy tools.
- Evidence limits: `{{files_filtered_and_semantic_status}}`

## Must Handle / Breaking Changes

Use this section for diff items where `must_handle` is `true` or `is_breaking` is `true`.

Show both flags independently; inclusion in this section does not imply that both flags are true.

| Location | Message | Old Value | New Value | Frontend Impact | Suggested Action |
|---|---|---|---|---|---|
| `{{item.location}}` | `{{item.message}}` | `{{item.old_value}}` | `{{item.new_value}}` | `{{item.frontend_impact}}` | `{{action_based_on_flags_and_consumer_usage}}` |

Checklist:

- Identify request changes that break callers, such as removed endpoints, new required parameters, required request body fields, auth scheme changes, or enum narrowing.
- Identify response changes that break consumers, such as removed fields, type changes, required-field changes, status removal, or enum narrowing.
- Tie every recommendation to `location`, `message`, `old_value`, `new_value`, `frontend_impact`, `is_breaking`, and `must_handle` returned by Vdoc MCP.

## Optional / Non-breaking Changes

Use this section for diff items where `must_handle` is `false` and `is_breaking` is `false`.

| Location | Message | Old Value | New Value | Frontend Impact | Optional Follow-up |
|---|---|---|---|---|---|
| `{{item.location}}` | `{{item.message}}` | `{{item.old_value}}` | `{{item.new_value}}` | `{{item.frontend_impact}}` | `{{optional_action}}` |

Checklist:

- Call out additive response fields, new optional parameters, new non-required request fields, and informational endpoint additions as optional/non-breaking unless Vdoc MCP marks them otherwise.
- Do not promote optional/non-breaking items into required work without MCP evidence.

## Suggested Frontend Work Plan

- First address items marked `must_handle`; assess other breaking changes against the consumer's actual usage.
- Then decide whether optional/non-breaking changes should be adopted for product value.
- If Vdoc MCP did not return enough endpoint detail for code changes, read the complete exact OpenAPI commit (or `get_endpoint_detail` for a legacy version) before generating code.

## Execution boundary

Vdoc MCP supplies exact document facts, immutable commits and merge proposals. The host agent may apply local changes when the user requests implementation; report the files changed and relevant verification. MCP itself cannot publish a version or edit the consumer repository.
