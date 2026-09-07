import test from "node:test";
import assert from "node:assert/strict";

import options from "./poweri-web-options.js";

const { DEFAULT_PORT, POWERI_ENTRY, isEnabled, poweriEntryUrl, resolveLaunch } = options;

test("poweri-web defaults to the PowerI-dedicated port 9989", () => {
  const launch = resolveLaunch([], {});
  assert.equal(launch.port, DEFAULT_PORT);
  assert.equal(DEFAULT_PORT, "9989", "9989 is the port the release shell also uses");
  assert.equal(launch.portIsDefault, true, "a bare default must be injected as PORT");
  assert.equal(launch.hostname, "127.0.0.1");
  assert.equal(launch.openBrowser, true);
});

test("the browser target is the PowerI entry, never the upstream root page", () => {
  assert.equal(POWERI_ENTRY, "/poweri");
  assert.equal(poweriEntryUrl("127.0.0.1", "9989"), "http://127.0.0.1:9989/poweri");
  assert.equal(poweriEntryUrl("0.0.0.0", "3000"), "http://0.0.0.0:3000/poweri");
});

test("explicit port flags win over the default in every accepted form", () => {
  for (const args of [["-p", "3000"], ["--port", "3000"], ["--port=3000"], ["-p3000"]]) {
    const launch = resolveLaunch(args, {});
    assert.equal(launch.port, "3000", `${args.join(" ")} → 3000`);
    assert.equal(launch.portIsDefault, false, `${args.join(" ")} must not inject PORT`);
  }
});

test("precedence is flag > PORT env > fork default (same as upstream)", () => {
  const fromEnv = resolveLaunch([], { PORT: "7777" });
  assert.equal(fromEnv.port, "7777");
  assert.equal(fromEnv.portIsDefault, false, "an existing PORT reaches upstream untouched");

  const flagWins = resolveLaunch(["-p", "3000"], { PORT: "7777" });
  assert.equal(flagWins.port, "3000");
});

test("hostname resolves from flag, then PI_WEB_HOSTNAME, then loopback", () => {
  assert.equal(resolveLaunch(["-H", "0.0.0.0"], {}).hostname, "0.0.0.0");
  assert.equal(resolveLaunch([], { PI_WEB_HOSTNAME: "10.0.0.5" }).hostname, "10.0.0.5");
  assert.equal(resolveLaunch([], {}).hostname, "127.0.0.1");
});

test("browser opening is opt-out via flag or env", () => {
  assert.equal(resolveLaunch(["--no-open"], {}).openBrowser, false);
  for (const value of ["1", "true", "yes", "on", "TRUE"]) {
    assert.equal(resolveLaunch([], { PI_WEB_NO_OPEN: value }).openBrowser, false, value);
  }
  assert.equal(isEnabled("off"), false);
  assert.equal(isEnabled(undefined), false);
});

test("--help/-h is claimed by poweri-web, not by the upstream text", () => {
  for (const args of [["--help"], ["-h"]]) {
    assert.equal(resolveLaunch(args, {}).help, true, args.join(" "));
  }
});

test("malformed port input defers to the upstream launcher's own error", () => {
  // strict:false yields `true` rather than throwing; portIsDefault must stay
  // false so we never overwrite a caller-supplied PORT, and the launcher's
  // numeric guard skips the browser poll.
  const launch = resolveLaunch(["--port"], { PORT: "7777" });
  assert.equal(launch.portIsDefault, false);
  assert.equal(/^\d+$/.test(String(launch.port)), false, "non-numeric port is left for upstream to reject");
});
