const TOKEN_PATTERN = /vdoc_[A-Za-z0-9._~+/=-]+/g;
const JSON_AUTH_PATTERN = /("authorization"\s*:\s*")([^"]+)(")/gi;
const AUTH_HEADER_PATTERN = /(authorization\s*[:=]\s*)([^\r\n,}\]]+)/gi;

export function redactSecrets(value: unknown, configuredToken = ""): string {
  const text = value instanceof Error ? value.message : stringify(value);
  // Match the configured value literally, including nonstandard token formats.
  const withoutConfiguredToken = configuredToken === "" ? text : text.split(configuredToken).join("[redacted]");
  return withoutConfiguredToken
    .replace(JSON_AUTH_PATTERN, "$1[redacted]$3")
    .replace(TOKEN_PATTERN, "vdoc_[redacted]")
    .replace(AUTH_HEADER_PATTERN, "$1[redacted]");
}

// Data has already been decoded from JSON. Copy it before the SDK serializes an
// error, preserving diagnostic types without sharing the upstream object. An
// explicit stack also avoids adding a recursive traversal limit to this path.
export function redactRPCErrorData(value: unknown, configuredToken = ""): unknown {
  const copyValue = (item: unknown): unknown => {
    if (typeof item === "string") return redactSecrets(item, configuredToken);
    if (Array.isArray(item)) return [];
    if (typeof item === "object" && item !== null) return {};
    return item;
  };
  const isContainer = (item: unknown): item is object => typeof item === "object" && item !== null;
  const result = copyValue(value);
  const pending: { source: object; target: object }[] = [];
  if (isContainer(value) && isContainer(result)) pending.push({ source: value, target: result });
  while (pending.length > 0) {
    const { source, target } = pending.pop()!;
    for (const [key, item] of Object.entries(source)) {
      const authorization = key.toLowerCase() === "authorization";
      const copied = authorization ? "[redacted]" : copyValue(item);
      // defineProperty preserves a JSON "__proto__" key as an ordinary field.
      Object.defineProperty(target, redactSecrets(key, configuredToken), {
        value: copied, enumerable: true, configurable: true, writable: true,
      });
      if (!authorization && isContainer(item) && isContainer(copied)) {
        pending.push({ source: item, target: copied });
      }
    }
  }
  return result;
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") return serialized;
  } catch {
    // Errors may be BigInts, circular objects, or values with a throwing toJSON.
  }
  try {
    return String(value);
  } catch {
    return "[unprintable error]";
  }
}
