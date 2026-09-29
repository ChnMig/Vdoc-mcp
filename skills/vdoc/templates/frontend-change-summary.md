# Frontend Change Summary Template

Use this template after calling `compare_api_versions` and, when helpful, `get_change_summary`. Do not fill contract facts from memory or source code alone.

## Source

- Project: `{{project_id_or_name}}`
- Document: `{{document_id_or_name}}`
- Branches: `{{from_branch_id_or_name}}` → `{{to_branch_id_or_name}}`
- From version: `{{from_version_id_or_name}}`
- To version: `{{to_version_id_or_name}}`
- MCP calls used: `compare_api_versions` `{{diff_id}}`, optional `get_change_summary`

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
- If Vdoc MCP did not return enough endpoint detail for code changes, call `get_endpoint_detail` for the affected endpoint before generating code.

## v0.1 Boundary

Vdoc MCP supplies contract facts and draft operations. The host agent may apply local changes when the user requests implementation; report the files changed and relevant verification. MCP itself cannot publish a version or edit the consumer repository.
