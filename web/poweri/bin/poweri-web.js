#!/usr/bin/env node
"use strict";

// poweri-web standalone launcher — the PowerI fork's own CLI identity.
//
// Two differences from upstream `bin/pi-web.js`, both deliberate:
//   1. default port 9989 — the PowerI-dedicated port the release desktop shell
//      also uses, so a standalone instance is distinct from pi-web AND is
//      auto-reused by the desktop app;
//   2. the browser opens `/poweri` (the product entry) instead of `/`, which
//      serves the upstream pi-web chat UI. Upstream's opener can only build a
//      root URL, and a root redirect would mean modifying upstream-held files
//      (`proxy.ts` / `next.config.ts`) — the fork red line — so the opener
//      lives here instead.
//
// Everything else (node version gating, PI_WEB_* handling, the `next start`
// spawn) is delegated to the untouched upstream launcher: fork defaults are
// applied, then `require` runs it. Upstream `bin/` files are never modified.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getPoweriHelpText, poweriEntryUrl, resolveLaunch } = require("./poweri-web-options.js");

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_INTERVAL_MS = 300;

const launch = resolveLaunch(process.argv.slice(2), process.env);

if (launch.help) {
  console.log(getPoweriHelpText());
  process.exit(0);
}

// Hand the fork's default port to the upstream launcher through PORT (the
// documented fallback slot). An explicit `-p`/`PORT` is left as-is so upstream
// resolves exactly the value the caller asked for.
if (launch.portIsDefault) {
  process.env.PORT = launch.port;
}

// Suppress upstream's browser open when we are going to do it ourselves — it
// would land on `/` (upstream UI). `--no-open` / PI_WEB_NO_OPEN already told
// upstream not to open, so nothing to do in that case.
if (launch.openBrowser) {
  process.env.PI_WEB_NO_OPEN = "1";
}

// Delegate: upstream re-parses argv (strictly, owning all error messages),
// checks the node version, and spawns `next start`. It has no require.main
// guard, so requiring it runs it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(path.join(__dirname, "..", "..", "bin", "pi-web.js"));

if (launch.openBrowser) {
  // Malformed argv (e.g. `--port` with no value → parseArgs yields `true`)
  // leaves the upstream launcher to report the canonical error; polling a
  // nonsense URL would only keep the process alive for nothing.
  if (/^\d+$/.test(String(launch.port))) {
    openEntryWhenReady(poweriEntryUrl(launch.hostname, launch.port));
  }
}

/**
 * Poll `url` until the server answers, then hand it to the platform browser.
 * Best-effort: a server that never comes up must not spawn a browser tab on an
 * error page, and a failed opener must never take the server down.
 */
function openEntryWhenReady(url, deadline = Date.now() + READY_TIMEOUT_MS) {
  const attempt = () => {
    const req = http.get(url, (res) => {
      res.resume(); // drain so the socket closes
      if (res.statusCode && res.statusCode < 400) {
        openInBrowser(url);
        return;
      }
      schedule();
    });
    req.on("error", schedule);
    req.setTimeout(2000, () => {
      req.destroy();
      schedule();
    });
  };
  const schedule = () => {
    if (Date.now() >= deadline) return;
    setTimeout(attempt, READY_POLL_INTERVAL_MS);
  };
  attempt();
}

/** Structured argv per platform (no `shell: true`, matching upstream's DEP0190 stance). */
function openInBrowser(url) {
  try {
    const opener =
      process.platform === "win32"
        ? spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], { stdio: "ignore", detached: true })
        : process.platform === "darwin"
          ? spawn("open", [url], { stdio: "ignore", detached: true })
          : spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    opener.unref();
  } catch {
    // Opening a browser is a convenience; the server keeps running regardless.
  }
}
