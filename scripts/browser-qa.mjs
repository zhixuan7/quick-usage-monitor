import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync, existsSync } from "node:fs";
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
  creatorDisplay: "Test Creator (creator@example.com)",
  region: "ap-southeast-2",
  connectors: ["c"],
  permissions: [
    {
      Principal: "test-user",
      PrincipalDisplay: "Test User (test@example.com)",
      Actions: ["quicksight:DescribeAgent"],
    },
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
  "/api/monitor/history": {
    items: [
      {
        event: "BaselineObserved",
        resourceType: "agent:ap-southeast-2",
        resourceName: "Test agent",
        observedAt: "2026-11-03T00:00:00Z",
        changedFields: ["name"],
      },
    ],
    intervalMinutes: 15,
  },
  "/api/monitor/invocations": {
    items: [
      {
        id: "e",
        event: "InvokeAction",
        action: "Read",
        connectorId: "c",
        connectorName: "Test connector",
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
    ["connectors", "Test connector"],
    ["invocations", "Test connector"],
    ["relationships", "Test connector"],
    ["audit", "CreateAgent"],
  ]) {
    await page.goto(`http://127.0.0.1:4317/${path}/`);
    await page.getByText(text, { exact: true }).first().waitFor();
    console.log(`PASS ${path}`);
  }
  await page.goto("http://127.0.0.1:4317/agents/");
  await page
    .getByText("Test Creator (creator@example.com)", { exact: true })
    .waitFor();
  await page.getByText("Configuration history", { exact: true }).waitFor();
  await page.getByText("Initial configuration", { exact: true }).waitFor();
  for (const name of [
    "Knowledge sync",
    "Collection health",
    "Agent permissions",
    "System health",
  ])
    assert.equal(
      await page.getByRole("link", { name, exact: true }).count(),
      0,
    );
  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await page.getByText("quicksight:DescribeAgent", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Permissions", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({
    path: ".qa-output/agent-permissions.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Agent inventory", exact: true })
    .click();
  await page
    .getByText("Test Creator (creator@example.com)", { exact: true })
    .waitFor();
  await page.screenshot({
    path: ".qa-output/agents.png",
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "PASS merged agent views, creator display, history explanation and removed navigation",
  );
  await page.goto("http://127.0.0.1:4317/permissions/");
  await page.waitForURL(
    (u) =>
      u.pathname === "/agents/" && u.searchParams.get("tab") === "permissions",
  );
  await page.getByText("quicksight:DescribeAgent", { exact: true }).waitFor();
  console.log("PASS legacy permissions bookmark");
  await page.goto("http://127.0.0.1:4317/invocations/");
  await page.getByText("Test connector", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Details", exact: true })
    .first()
    .click();
  assert.ok(
    (await page.locator("pre").textContent()).includes('"connectorId": "c"'),
  );
  assert.equal(existsSync("frontend/out/health/index.html"), false);
  assert.equal(existsSync("frontend/out/kb-sync/index.html"), false);
  console.log(
    "PASS connector names preserve IDs in details and removed pages are not exported",
  );
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
  await page.screenshot({
    path: ".qa-output/directory.png",
    fullPage: true,
    animations: "disabled",
  });
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
    animations: "disabled",
  });
  throw e;
} finally {
  await browser.close();
}
