import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
mkdirSync(".qa-output", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const agent = {
  id: "a",
  name: "Test agent",
  status: "ACTIVE",
  creator: "test-user",
  region: "ap-southeast-2",
  connectors: ["c"],
  permissions: [
    { Principal: "test-user", Actions: ["quicksight:DescribeAgent"] },
  ],
  observedAt: "2026-11-03T00:00:00Z",
};
const routes = {
  "/api/me/permissions": {
    dashboard: true,
    users: true,
    chatLogs: true,
    storage: true,
    kbSync: true,
    regions: true,
    reports: true,
  },
  "/api/monitor/directory": {
    users: [
      {
        id: "u",
        name: "Test User",
        email: "test@example.com",
        groups: [{ id: "g", name: "Monitoring Admins" }],
        quickAccounts: [{ arn: "arn:test:user", role: "ADMIN_PRO" }],
      },
    ],
    groups: [
      { id: "g", name: "Monitoring Admins", memberIds: ["u"] },
      { id: "empty", name: "Other group", memberIds: [] },
    ],
  },
  "/api/users": [{ userArn: "arn:test:user", messages: 5 }],
  "/api/monitor/agents": { items: [agent] },
  "/api/monitor/connectors": {
    items: [
      {
        id: "c",
        name: "Test connector",
        type: "MCP",
        status: "ACTIVE",
        enabledActions: ["Read"],
        region: "ap-southeast-2",
      },
    ],
  },
  "/api/monitor/agent-events": {
    items: [
      {
        event: "UpdateAgentPermissions",
        agentName: "Test agent",
        granted: ["viewer"],
        timestamp: "2026-11-03T00:00:00Z",
      },
    ],
  },
  "/api/monitor/history": { items: [] },
  "/api/monitor/invocations": {
    items: [
      {
        id: "e",
        event: "InvokeAction",
        action: "Read",
        connectorId: "c",
        status: "SUCCESS",
      },
    ],
  },
  "/api/monitor/audit": {
    items: [
      { id: "e", event: "CreateAgent", actor: "Test User", status: "Recorded" },
    ],
  },
  "/api/monitor/health": {
    sync: {
      status: "ok",
      updatedAt: "2026-11-03T00:00:00Z",
      sources: [{ name: "identity-center", status: "ok" }],
    },
    streams: [
      {
        region: "ap-southeast-2",
        source: "agent-metadata",
        status: "no-events-yet",
      },
    ],
  },
};
await page.route("**/config.json", (route) =>
  route.fulfill({
    json: {
      apiUrl: "http://127.0.0.1:4317",
      region: "ap-southeast-2",
      userPoolId: "test",
      userPoolClientId: "test",
      ssoConfigured: false,
    },
  }),
);
await page.route("**/api/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ json: routes[path] ?? {} });
});
await page.addInitScript(() => {
  sessionStorage.setItem(
    "qum.idToken",
    "x." + btoa(JSON.stringify({ email: "test@example.com" })) + ".x",
  );
  sessionStorage.setItem("qum.expiry", String(Date.now() + 3600000));
});
try {
  for (const [path, text] of [
    ["directory", "Test User"],
    ["agents", "Test agent"],
    ["permissions", "quicksight:DescribeAgent"],
    ["connectors", "Test connector"],
    ["invocations", "SUCCESS"],
    ["relationships", "Test connector"],
    ["audit", "CreateAgent"],
    ["health", "identity-center"],
  ]) {
    await page.goto(`http://127.0.0.1:4317/${path}/`);
    await page.getByText(text, { exact: true }).first().waitFor();
    console.log(`PASS ${path}`);
  }
  await page.goto("http://127.0.0.1:4317/directory/");
  await page.getByText("Test User", { exact: true }).waitFor();
  await page
    .getByLabel("Identity Center group", { exact: true })
    .selectOption("empty");
  await page
    .getByText("No records for the selected filters.", { exact: false })
    .waitFor();
  console.log("PASS group filter");
  await page
    .getByLabel("Identity Center group", { exact: true })
    .selectOption("g");
  await page.getByText("Test User", { exact: true }).waitFor();
  await page.screenshot({ path: ".qa-output/directory.png", fullPage: true });
  await page.goto("http://127.0.0.1:4317/login/");
  await page
    .getByRole("button", { name: "Sign in with your company account" })
    .click();
  await page
    .getByText(
      "SSO application setup is pending. Contact your dashboard administrator.",
      { exact: true },
    )
    .waitFor();
  console.log("PASS pending federation message");
  assert.deepEqual(errors, []);
  console.log("PASS no browser runtime errors");
} catch (e) {
  console.log("URL", page.url());
  console.log("ERRORS", errors);
  console.log((await page.locator("body").innerText()).slice(0, 5000));
  await page.screenshot({
    path: ".qa-output/failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
