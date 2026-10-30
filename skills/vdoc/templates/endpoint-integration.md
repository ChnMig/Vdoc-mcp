# Endpoint Integration Template

Use this template after reading the complete OpenAPI document with `get_document_at_commit`, or exact legacy endpoint detail with `get_endpoint_detail`. Generate code only from that selected immutable source.

## MCP Requirement

- Current call: `get_document_at_commit` with `project_id`, `commit_id`, `document_id`; use the exact returned OpenAPI definitions.
- Legacy endpoint call: `get_endpoint_detail`
- Required arguments: `project_id`, `document_id`, `version_id`, `endpoint_id`
- Resolve the endpoint ID first with `list_api_endpoints`; its optional `method` and `path` filters match the selected version's operation, with an exact OpenAPI path template.
- Source of truth: the returned endpoint method, path, operationId, parameters, request body, responses, security, servers, required fields, and enum values

## Contract Inputs From `get_endpoint_detail`

- Method: `{{method}}`
- Path: `{{path}}`
- operationId (returned as `operation_id`): `{{operation_id}}`
- Parameters: `{{parameters}}`
- Request body: `{{request_body}}`
- Responses: `{{responses}}`
- Security: `{{security}}`
- Servers: `{{servers}}`
- Required fields: `{{required_fields}}`
- Enum values: `{{enum_values}}`
- Reference identifiers: `{{schema_refs}}`; use definitions already resolved in the detail/`normalized_operation`, not the identifier list as a definition source.

## Integration Output

### Types

- Request parameter types come only from returned parameters.
- Request body types come only from the returned request body schema and required fields.
- Response types come only from returned responses, status codes, required fields, and enum values.

### Request Function

- Use the returned method and path exactly.
- Include only returned path, query, header, cookie, and body inputs.
- Apply only returned security requirements. Do not invent an auth scheme.
- If servers are returned, document the selected server or base URL assumption.

### Validation Notes

- Mark every required field as required in generated types.
- Preserve enum values exactly as returned by Vdoc MCP.
- If a field, parameter, response, security scheme, or server is missing from the MCP result, write `not returned by Vdoc MCP` instead of guessing.

## Final Response Shape

- Contract summary: method, path, operationId, security, and servers.
- Source: project/document ID, historical path, branch/ref, full commit ID and publication state. For legacy sources, cite the exact published version ID/name instead; do not substitute it for a commit ID.
- Generated types or request snippet, if requested.
- Assumptions limited to values explicitly absent from Vdoc MCP and clearly labeled as not returned.
