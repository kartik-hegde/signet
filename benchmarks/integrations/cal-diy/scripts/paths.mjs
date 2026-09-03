import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const benchmark = path.resolve(here, "../../../..");
export const workspace = path.join(benchmark, ".external");
export const application =
  process.env.CAL_DIY_DIR ?? path.join(workspace, "cal-diy-signett");
export const signett = process.env.SIGNETT_DIR ?? benchmark;
export const databaseCompose = path.join(application, "packages/prisma");
export const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5450/cal-saml";
