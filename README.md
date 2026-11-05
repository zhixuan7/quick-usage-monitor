# Amazon Quick Usage & Audit Monitor

A reusable AWS CDK deployment for a Next.js dashboard: Quick usage, IAM Identity Center users grouped by membership, agents with a Permissions view, connectors, actual invocations, configured relationships and an audit timeline. Connector invocations display inventory names, and agent creators display their directory name/email when resolvable. Original IDs remain in record details.

Frontend: private S3 origin + CloudFront. API: HTTP API + Lambda, with Cognito JWT validation and a live Identity Center group membership check on every request. Federation claims are read from the original bearer token and bound to the verified gateway subject/issuer/audience, avoiding nested-claim serialization differences. Inventory: scheduled Lambda + DynamoDB snapshots. Evidence: regional Quick vended logs and a dedicated multi-region CloudTrail trail delivering to CloudWatch and S3. Source systems are read-only to the collectors.

## Deploy to an AWS account

Requirements: Node.js 22+, AWS CLI v2, an active Quick subscription, an organization instance of IAM Identity Center, permission to deploy CDK resources, and an existing monitoring administrators group. Use the AWS profile for the target account. The deployment script verifies its STS account before proceeding.

```bash
git clone https://github.com/zhixuan7/quick-usage-monitor.git
cd quick-usage-monitor
npm ci
cp config/example.json config/account.local.json
# Edit account, region, identityStoreId, identityCenterRegion, allowedGroupIds.
export AWS_PROFILE=your-profile
export AWS_REGION=ap-southeast-2
cd infra
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-southeast-2
cd ..
npm run deploy -- config/account.local.json
```

Configuration files ending in `.local.json`, deployment outputs, credentials, node_modules and build artifacts are ignored by Git. There are no account-specific secrets in the source. An optional `existingUserPoolId` can reuse an existing retained monitor pool during recovery. One monitor stack per account/region is supported; logs and SSM paths use fixed monitor names.

The first deployment creates the dashboard and data collection with SSO **pending**. It has no local-password sign-in and no publicly accessible data API. Finish federation as below, then redeploy the same stack.

## Connect existing Identity Center / Entra ID sign-in

AWS requires creation of a customer-managed SAML application in the Identity Center console; this application type cannot be created with the public CreateApplication API.

1. In the Identity Center primary region, add a customer-managed **SAML 2.0** application called `Quick Usage Monitor`.
2. Enter `SamlAcsUrl` and `SamlEntityId` from the stack outputs as the ACS URL and application SAML audience. Set application start URL to `DashboardUrl`.
3. Map `Subject` to `${user:subject}` with persistent format, and `email` to `${user:email}` with unspecified format. The application relies on an authoritative email assertion; the backend requires exactly one matching Identity Store user and verifies live group membership. Ambiguous or absent identities are denied.
4. Assign only the intended monitoring administrators group. Assignment alone is insufficient: its group ID must also be present in `allowedGroupIds`.
5. Copy the **IAM Identity Center SAML metadata URL** into `samlMetadataUrl` in your local account configuration. Alternatively, download the application metadata XML to an ignored `config/*.local.xml` file and set `samlMetadataFile` to its path relative to your account configuration file. Set only one of the two fields. With a downloaded file, replace it and redeploy when Identity Center rotates its signing certificate. Do not use Entra's metadata directly: Identity Center is the application's federation endpoint.
6. Redeploy with the same command. The login button then redirects through Identity Center and Entra ID. OAuth authorization-code flow uses PKCE and state validation and requests `openid email profile`; profile claims are required for the federation check. After a scope change, sign out and sign in again to replace older tokens.
7. Validate an authorized user can read data and a user outside the configured monitoring group receives 403. Removing a group membership is enforced on the next API request.

All authorized monitoring group members can view the same account-wide evidence. Group filters are analytical filters, not tenant-isolation boundaries. Directory access requires `identitystore:ListUsers`, `ListGroups`, and `ListGroupMemberships`; API authorization also requires `ListGroupMembershipsForMember`. Cross-account Identity Center deployments need an explicitly configured role/trust policy; this version assumes the directory is readable by the deployment account's Lambda roles.

## Coverage and semantics

- The scheduled inventory runs every 15 minutes by default and immediately after first deployment. Public Quick APIs capture baseline agents, permissions, connectors and explicit attachments.
- Six vended log types: CHAT_LOGS, FEEDBACK_LOGS, AGENT_HOURS_LOGS, INDEX_USAGE_LOGS, KB_FILE_SYNC_LOGS, AGENT_METADATA_LOGS. Existing delivery sources are reused without altering their field selection; destinations are separate. Unsupported sources are visible on the Regions page and in CloudWatch collector logs.
- Lifecycle and permission events come from AGENT_METADATA_LOGS; connector management and actual InvokeAction activity come from CloudTrail. Connector availability in chat logs is labelled separately from calls.
- The dedicated trail preserves all existing trails and selectors. It captures management events (an additional billable copy when another trail already captures them) plus ActionConnector data events (also billable). Scope/cost should be reviewed when expanding regions or event volumes.
- Snapshot observations are not exact audit timestamps. Missing resources are marked only after a complete successful source enumeration. Failed enumerations preserve last-known data and report an error.
- Quick users are joined to directory identities by stable ID where available, otherwise unique exact email. Ambiguous matches are unresolved. Group reporting is labelled as current membership; snapshots support observed history but cannot reconstruct uncaptured earlier changes.
- Explicit agent attachments are not effective permissions and do not prove invocation. Agents without attachments can still have access to dynamically available connectors. Invocation records without an agent ID remain unattributed.
- Audit pages show at most the latest 1,000 matching records in the selected period. Narrow the time window for busy accounts. S3 holds full captured CloudTrail history; no claim of complete historical search through the UI.
- Collection starts when enabled; no automatic historical backfill from existing trails. Quick usage delivery may be delayed. Inventory synchronization and pipeline diagnostics remain available through the protected monitoring API and CloudWatch logs.
- Sensitive connector authentication metadata is never stored in inventory. Agent prompt bodies are excluded from inventory/API projections. Usage chat logs may contain customer content; authorize dashboard users accordingly.
- Defaults: 90-day CloudWatch retention, 365-day audit archive, 365-day snapshot TTL. Inventory, user pool and audit data are retained on stack removal. Delete retained resources separately only when intentional.

## Verify and maintain

```bash
npm test
npm run typecheck
npm run build:frontend
cd infra
npx cdk diff --context config=/ABSOLUTE/PATH/config/account.local.json
```

The internal `/api/monitor/health` endpoint reports each source error and overdue inventory. The Collection health and Knowledge sync pages have been removed from the dashboard. CloudWatch includes Lambda error alarms and a custom collector-error metric; alarm notification subscriptions and AWS Budgets recipients are account-specific and should be configured by the account owner. This deployment does not create email/SMS subscriptions.

Browser checks use synthetic fixtures and do not bypass deployed authentication. To run them, serve `frontend/out` on 127.0.0.1:4317 and run `node scripts/browser-qa.mjs`. It uses installed Google Chrome on macOS; set CHROME_PATH on other platforms. Test screenshots go to ignored `.qa-output/`.

Repeat `npm run deploy -- config/account.local.json` for updates. For another account, copy the example configuration, supply its directory/group IDs, switch AWS_PROFILE, bootstrap that account/region, and deploy. Do not reuse this account's Cognito pool or SAML application in another account.

## Configuration history

Configuration history is a set of observations from periodic inventory checks (15 minutes by default). Initial configuration means the first saved snapshot; Configuration changed means a later check detected differences. Observed timestamps are not exact edit times, and changes between checks can be missed. Use agent audit events or the audit timeline to identify recorded actions and actors. Agent inventory and Permissions share the Agents page; old `/permissions/` bookmarks redirect to its Permissions view.

## Source provenance

Adapted from the `usage-monitor/` project in [CloudMile-Inc/amazon-quick-deployment-pack](https://github.com/CloudMile-Inc/amazon-quick-deployment-pack), commit `291cd91f6e8cf5385eed478108385f9bfef58658`. The upstream MIT-0 license is preserved in LICENSE. This fork adds Identity Center federation, directory/inventory collection, audit collection and category pages. Legacy documentation under docs/ describes the original monitor; this README takes precedence for this deployment.
