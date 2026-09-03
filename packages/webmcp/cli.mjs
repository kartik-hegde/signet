#!/usr/bin/env node

import { main } from "./eval-runtime/cli.mjs";

main().catch((error) => {
  process.stderr.write(
    `signett: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
