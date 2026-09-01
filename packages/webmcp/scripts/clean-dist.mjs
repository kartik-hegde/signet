import { rmSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
rmSync(dist, { recursive: true, force: true });
