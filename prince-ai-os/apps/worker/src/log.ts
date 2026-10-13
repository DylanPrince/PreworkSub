/** Minimal structured JSON logger. Never pass secrets or prompt contents in fields. */
type Fields = Record<string, unknown>;
function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "worker",
    event,
    ...fields,
  });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}
export const log = {
  info: (e: string, f?: Fields) => write("info", e, f),
  warn: (e: string, f?: Fields) => write("warn", e, f),
  error: (e: string, f?: Fields) => write("error", e, f),
};
