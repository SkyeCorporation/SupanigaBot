import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRelative, isProtectedPath } from "../core/files.js";

test("File manager menolak path sensitif", () => {
  for (const p of ["session/creds.json", ".env", "database/supaniga.db", ".git/config", "node_modules/x/a.js"]) {
    assert.equal(isProtectedPath(p), true, p);
  }
  assert.equal(isProtectedPath(".env.example"), false);
  assert.equal(isProtectedPath("cmds/ai.js"), false);
});

test("File manager menolak path keluar folder bot", () => {
  for (const p of ["../etc/passwd", "/etc/passwd", "cmds/../../x", "C:/x"]) {
    assert.throws(() => normalizeRelative(p), undefined, p);
  }
  assert.equal(normalizeRelative("./cmds/ai.js"), "cmds/ai.js");
});
