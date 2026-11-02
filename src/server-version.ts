export interface VersionDiagnostic {
  code: "version_mismatch" | "server_version_unknown";
  clientVersion: string;
  serverVersion?: string;
  message: string;
}

function releaseVersion(value: string | null): string | undefined {
  if (!value || value.length > 256) return undefined;
  const version = value.trim().replace(/^v/, "");
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)
    ? version
    : undefined;
}

export function diagnoseServerVersion(clientVersion: string, reportedVersion: string | null): VersionDiagnostic | undefined {
  const serverVersion = releaseVersion(reportedVersion);
  if (!serverVersion) {
    return {
      code: "server_version_unknown",
      clientVersion,
      message: `Cannot verify Vdoc server version; MCP client is ${clientVersion}. The backend did not report a recognizable version. Upgrade the backend to a version that supports this check; connection success does not confirm matching versions.`,
    };
  }
  if (serverVersion === releaseVersion(clientVersion)) return undefined;
  return {
    code: "version_mismatch",
    clientVersion,
    serverVersion,
    message: `Vdoc version mismatch: MCP client ${clientVersion}, server ${serverVersion}. Use the same release and channel for both components, then restart MCP. Update the older component or install the client version matching this server.`,
  };
}
