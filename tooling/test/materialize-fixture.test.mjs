import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeSignetLink } from "../materialize-fixture.mjs";

test("materializeSignetLink creates and reuses the external compatibility link", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "signet-materialize-"));
  const root = path.join(directory, "repository");
  const external = path.join(directory, "external");
  mkdirSync(root);
  try {
    assert.equal(materializeSignetLink({ root, external }).created, true);
    assert.equal(
      realpathSync(path.join(external, "signet")),
      realpathSync(root),
    );
    assert.equal(materializeSignetLink({ root, external }).created, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
