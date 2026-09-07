"use strict";

// Pure launch-decision helpers for the poweri-web standalone bin.
//
// Kept separate from the executable so the precedence rules can be unit-tested
// (same convention as upstream bin/pi-web-options.js ↔ bin/pi-web.js).
//
// Precedence mirrors upstream exactly — flag > env > fork default — so this
// wrapper and the delegated upstream launcher can never disagree about which
// port/host the server binds.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

/** PowerI-dedicated standalone port (shared with the release desktop shell). */
const DEFAULT_PORT = "9989";
const DEFAULT_HOSTNAME = "127.0.0.1";
/**
 * The PowerI product entry. Upstream pi-web owns `/` (its own chat UI), and
 * the fork cannot add a root redirect without modifying upstream-held files
 * (`proxy.ts` / `next.config.ts`), so the standalone launcher opens `/poweri`
 * explicitly instead of letting the browser land on the upstream UI.
 */
const POWERI_ENTRY = "/poweri";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function getPoweriHelpText() {
  return `Usage: poweri-web [options]

Start the PowerI Web UI server (standalone mode of @poweri/poweri-web).

Options:
  -p, --port <port>          Server port (default: ${DEFAULT_PORT}, or PORT)
  -H, --hostname <host>      Bind hostname (default: ${DEFAULT_HOSTNAME}, or PI_WEB_HOSTNAME)
      --no-open              Do not open a browser automatically
  -h, --help                 Show this help message and exit

Environment:
  PORT                       Default port when --port is omitted
  PI_WEB_HOSTNAME            Default hostname when --hostname is omitted
  PI_WEB_NO_OPEN             Set to 1/true/yes/on to disable browser open
  PI_WEB_PASSWORD            Enable HTTP Basic Auth (username is always "pi")
  PI_WEB_ALLOWED_HOSTS       Extra exact proxy/custom hostnames, comma-separated

The browser opens ${POWERI_ENTRY} — the PowerI product entry; the repository's
upstream pi-web UI still answers at \`/\`.
`;
}

/**
 * Resolve what the launcher should do from argv + env, without touching
 * process state. `strict:false` lets unknown flags pass through: the upstream
 * launcher re-parses strictly and owns the canonical error messages.
 *
 * @returns {{ help: boolean, port: string, portIsDefault: boolean,
 *   hostname: string, openBrowser: boolean }}
 */
function resolveLaunch(args, env) {
  const wantsHelp = args.includes("--help") || args.includes("-h");
  if (wantsHelp) return { help: true, port: DEFAULT_PORT, portIsDefault: true, hostname: DEFAULT_HOSTNAME, openBrowser: false };

  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        port: { type: "string", short: "p" },
        hostname: { type: "string", short: "H" },
        "no-open": { type: "boolean" },
      },
      strict: false,
      allowPositionals: true,
    }));
  } catch {
    // Malformed argv (e.g. `--port` with no value): defer entirely to the
    // upstream launcher, which produces the canonical parse error.
    return { help: false, port: DEFAULT_PORT, portIsDefault: false, hostname: DEFAULT_HOSTNAME, openBrowser: true };
  }

  const port = values.port ?? env.PORT ?? DEFAULT_PORT;
  return {
    help: false,
    port,
    // Only a bare default is injected into the child env; an explicit flag or
    // PORT must reach upstream untouched so it resolves the same value.
    portIsDefault: values.port === undefined && env.PORT === undefined,
    hostname: values.hostname ?? env.PI_WEB_HOSTNAME ?? DEFAULT_HOSTNAME,
    openBrowser: !values["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

/** The URL the standalone launcher hands to the browser (PowerI entry). */
function poweriEntryUrl(hostname, port) {
  return `http://${hostname}:${port}${POWERI_ENTRY}`;
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOSTNAME,
  POWERI_ENTRY,
  getPoweriHelpText,
  isEnabled,
  poweriEntryUrl,
  resolveLaunch,
};
