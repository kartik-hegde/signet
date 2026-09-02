import assert from "node:assert/strict";
import test from "node:test";

import {
  hasWebsiteAccess,
  requestWebsiteAccess,
  WEBSITE_ORIGINS,
} from "../website-access.mjs";

test("checks the persistent website permission as one HTTP/HTTPS grant", async () => {
  let requested;
  const permissions = {
    async contains(value) {
      requested = value;
      return true;
    },
  };

  assert.equal(await hasWebsiteAccess(permissions), true);
  assert.deepEqual(requested, { origins: WEBSITE_ORIGINS });
});

test("requests persistent website access in a single permission prompt", async () => {
  let requested;
  const permissions = {
    async request(value) {
      requested = value;
      return true;
    },
  };

  assert.equal(await requestWebsiteAccess(permissions), true);
  assert.deepEqual(requested, { origins: WEBSITE_ORIGINS });
});
