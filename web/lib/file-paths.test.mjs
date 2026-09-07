import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./file-paths.ts");
}

test("encodeFilePathForApi round-trips UNC paths through the marker segment", async () => {
  const { encodeFilePathForApi, decodeFilePathFromApi } = await loadSubject();

  // \\wsl$\Ubuntu\home\user\project — the WSL share form. The old encoder
  // dropped the empty segments the `//` prefix splits into, so the server
  // recovered "/wsl$/..." (a drive-relative path) instead of the UNC form
  // and the containment check failed with 403 Access denied.
  const unc = "\\\\wsl$\\Ubuntu\\home\\user\\project";
  const encoded = encodeFilePathForApi(unc);
  assert.ok(encoded.startsWith("__pi_unc__/"), `UNC prefix must survive encoding, got ${encoded}`);
  const segments = decodeURIComponent(encoded).split("/").filter(Boolean);
  const decoded = decodeFilePathFromApi(segments);
  assert.equal(decoded, "//wsl$/Ubuntu/home/user/project");
});

test("encodeFilePathForApi round-trips wsl.localhost and drive-letter paths", async () => {
  const { encodeFilePathForApi, decodeFilePathFromApi } = await loadSubject();

  const wslLocal = "\\\\wsl.localhost\\Ubuntu\\home\\user";
  const encodedLocal = encodeFilePathForApi(wslLocal);
  const segmentsLocal = decodeURIComponent(encodedLocal).split("/").filter(Boolean);
  assert.equal(decodeFilePathFromApi(segmentsLocal), "//wsl.localhost/Ubuntu/home/user");

  // Drive-letter paths must not gain the UNC marker.
  const drive = "D:\\repo\\sub";
  const encodedDrive = encodeFilePathForApi(drive);
  assert.ok(!encodedDrive.startsWith("__pi_unc__/"), `drive paths must not be marked, got ${encodedDrive}`);
  const segmentsDrive = decodeURIComponent(encodedDrive).split("/").filter(Boolean);
  assert.equal(decodeFilePathFromApi(segmentsDrive), "D:/repo/sub");
});

test("encodeFilePathForApi round-trips POSIX and relative-looking paths unchanged", async () => {
  const { encodeFilePathForApi, decodeFilePathFromApi } = await loadSubject();

  // POSIX paths are encoded without a leading slash (the catch-all route
  // strips it); decodeFilePathFromApi restores what encode emitted.
  const posix = "/Users/tianzhao/code/github/pi-web";
  const segments = decodeURIComponent(encodeFilePathForApi(posix)).split("/").filter(Boolean);
  assert.equal(decodeFilePathFromApi(segments), "Users/tianzhao/code/github/pi-web");

  const weird = "wsl$/Ubuntu"; // not a UNC path, just a weird relative name
  const segmentsWeird = decodeURIComponent(encodeFilePathForApi(weird)).split("/").filter(Boolean);
  assert.equal(decodeFilePathFromApi(segmentsWeird), "wsl$/Ubuntu");
});
