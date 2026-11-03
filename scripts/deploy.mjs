import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const file = resolve(process.argv[2] ?? "config/account.local.json");
const cfg = JSON.parse(readFileSync(file, "utf8"));
const aws = spawnSync(
  "aws",
  ["sts", "get-caller-identity", "--output", "json"],
  { encoding: "utf8" },
);
if (aws.status !== 0) throw new Error(aws.stderr);
if (JSON.parse(aws.stdout).Account !== cfg.account)
  throw new Error(
    "Refusing to deploy: credentials are for a different AWS account",
  );
for (const [command, args, cwd] of [
  ["npm", ["run", "build:frontend"], process.cwd()],
  [
    "npx",
    [
      "cdk",
      "deploy",
      cfg.stackName ?? "QuickUsageMonitor",
      "--context",
      `config=${file}`,
      "--require-approval",
      "never",
      "--no-rollback",
      "--outputs-file",
      resolve("cdk-outputs.local.json"),
    ],
    resolve("infra"),
  ],
]) {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_REGION: cfg.region,
      AWS_DEFAULT_REGION: cfg.region,
    },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
