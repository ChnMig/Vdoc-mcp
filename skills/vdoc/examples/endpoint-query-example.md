# Endpoint Query Example

Use this workflow before generating endpoint integration code, client types, request snippets, or endpoint-specific tests. The IDs below are placeholders; resolve real IDs with Vdoc MCP and never paste MCP tokens, JWTs, Authorization headers, or copied secret values into examples.

## Optional Tool Discovery

```json
{
  "jsonrpc": "2.0",
  "id": "tools-list-example",
  "method": "tools/list"
}
```

## Resolve The Target

Use `list_projects` and `list_documents` to identify the requested document. Use `list_document_branches` to resolve its branch, then select the requested entry from `list_api_versions` by branch and version name. Use the returned IDs below.

```json
{
  "jsonrpc": "2.0",
  "id": "endpoint-list-example",
  "method": "tools/call",
  "params": {
    "name": "list_api_endpoints",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "version_id": "ver_placeholder",
      "method": "GET",
      "path": "/widgets/{id}"
    }
  }
}
```

## Query Endpoint Detail

Replace `endpoint_placeholder` with the `id` returned for the matching method and path. An operationId or a URL path is not an endpoint ID.

```json
{
  "jsonrpc": "2.0",
  "id": "endpoint-detail-example",
  "method": "tools/call",
  "params": {
    "name": "get_endpoint_detail",
    "arguments": {
      "project_id": "proj_placeholder",
      "document_id": "doc_placeholder",
      "version_id": "ver_placeholder",
      "endpoint_id": "endpoint_placeholder"
    }
  }
}
```

Use only the returned method, path, operationId, parameters, request body, responses, security, servers, required fields, and enum values. If Vdoc MCP does not return a field, say it was not returned instead of guessing.
