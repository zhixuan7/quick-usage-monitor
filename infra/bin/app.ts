#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as fs from "fs";
import * as path from "path";
import { QuickMonitorStack } from "../lib/quick-monitor-stack";
const app = new cdk.App();
const file = app.node.tryGetContext("config");
if (!file)
  throw new Error("Pass --context config=/absolute/path/to/account.local.json");
const cfg = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
if (
  !/^\d{12}$/.test(cfg.account) ||
  !cfg.identityStoreId ||
  !cfg.allowedGroupIds?.length
)
  throw new Error("account, identityStoreId and allowedGroupIds are required");
if (
  process.env.CDK_DEFAULT_ACCOUNT &&
  process.env.CDK_DEFAULT_ACCOUNT !== cfg.account
)
  throw new Error("AWS credentials do not match the configured target account");
Object.entries(cfg).forEach(([key, value]) => app.node.setContext(key, value));
cdk.Tags.of(app).add("project", "quick-usage-monitor");
new QuickMonitorStack(app, cfg.stackName ?? "QuickUsageMonitor", {
  env: { account: cfg.account, region: cfg.region },
});
