import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const schemaPath = "packages/db/prisma/schema.prisma";

if (!existsSync(schemaPath)) {
  console.log(`Skipping Prisma generate: ${schemaPath} is not present in this install context.`);
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "prisma", "generate", "--schema", schemaPath], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
