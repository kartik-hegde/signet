#!/usr/bin/env node

import { main } from "@signett/eval/cli";

main().catch((error) => {
  process.stderr.write(
    `signett: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
