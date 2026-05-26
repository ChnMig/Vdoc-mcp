const TOKEN_PATTERN = /vdoc_[A-Za-z0-9._~+/=-]+/g;
const JSON_AUTH_PATTERN = /("authorization"\s*:\s*")([^"]+)(")/gi;
const AUTH_HEADER_PATTERN = /(authorization\s*[:=]\s*)([^\r\n,}\]]+)/gi;

export function redactSecrets(value: unknown): string {
  const text = value instanceof Error ? value.message : stringify(value);
  return text
    .replace(JSON_AUTH_PATTERN, "$1[redacted]$3")
    .replace(TOKEN_PATTERN, "vdoc_[redacted]")
    .replace(AUTH_HEADER_PATTERN, "$1[redacted]");
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
