# Amazon Quick Usage & Audit Monitor

A reusable AWS CDK deployment for a Next.js dashboard: Quick usage, IAM Identity Center users grouped by membership, agents, permissions, connectors, actual invocations, configured relationships, audit timeline and collection health.

Frontend: private S3 origin + CloudFront. API: HTTP API + Lambda, with Cognito JWT validation and a live Identity Center group membership check on every request. Inventory: scheduled Lambda + DynamoDB snapshots. Evidence: regional Quick vended logs and a dedicated multi-region CloudTrail trail delivering to CloudWatch and S3. Source systems are read-only to the collectors.

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

Configuration files ending in `.local.json`, deployment outputs, credentials, node_modules and build artifacts are ignored by Git. There are no account-specific secrets in the source. One monitor stack per account/region is supported; logs and SSM paths use fixed monitor names.

The first deployment creates the dashboard and data collection with SSO **pending**. It has no local-password sign-in and no publicly accessible data API. Finish federation as below, then redeploy the same stack.

## Connect existing Identity Center / Entra ID sign-in

AWS requires creation of a customer-managed SAML application in the Identity Center console; this application type cannot be created with the public CreateApplication API.

1. In the Identity Center primary region, add a customer-managed **SAML 2.0** application called `Quick Usage Monitor`.
2. Enter `SamlAcsUrl` and `SamlEntityId` from the stack outputs as the ACS URL and application SAML audience. Set application start URL to `DashboardUrl`.
3. Map `Subject` to `${user:subject}` with persistent format, and `email` to `${user:email}` with unspecified format. The application relies on an authoritative email assertion; the backend requires exactly one matching Identity Store user and verifies live group membership. Ambiguous or absent identities are denied.
4. Assign only the intended monitoring administrators group. Assignment alone is insufficient: its group ID must also be present in `allowedGroupIds`.
5. Copy the **IAM Identity Center SAML metadata URL** into `samlMetadataUrl` in your local account configuration. Do not use Entra's metadata directly: Identity Center is the application's federation endpoint.
6. Redeploy with the same command. The login button then redirects through Identity Center and Entra ID. OAuth authorization-code flow uses PKCE and state validation.
7. Validate an authorized user can read data and a user outside the configured monitoring group receives 403. Removing a group membership is enforced on the next API request.

All authorized monitoring group members can view the same account-wide evidence. Group filters are analytical filters, not tenant-isolation boundaries. Directory access requires `identitystore:ListUsers`, `ListGroups`, and `ListGroupMemberships`; API authorization also requires `ListGroupMembershipsForMember`. Cross-account Identity Center deployments need an explicitly configured role/trust policy; this version assumes the directory is readable by the deployment account's Lambda roles.

## Coverage and semantics

- The scheduled inventory runs every 15 minutes by default and immediately after first deployment. Public Quick APIs capture baseline agents, permissions, connectors and explicit attachments.
- Six vended log types: CHAT_LOGS, FEEDBACK_LOGS, AGENT_HOURS_LOGS, INDEX_USAGE_LOGS, KB_FILE_SYNC_LOGS, AGENT_METADATA_LOGS. Existing delivery sources are reused without altering their field selection; destinations are separate. Unsupported sources are visible in collection health.
- Lifecycle and permission events come from AGENT_METADATA_LOGS; connector management and actual InvokeAction activity come from CloudTrail. Connector availability in chat logs is labelled separately from calls.
- The dedicated trail preserves all existing trails and selectors. It captures management events (an additional billable copy when another trail already captures them) plus ActionConnector data events (also billable). Scope/cost should be reviewed when expanding regions or event volumes.
- Snapshot observations are not exact audit timestamps. Missing resources are marked only after a complete successful source enumeration. Failed enumerations preserve last-known data and report an error.
- Quick users are joined to directory identities by stable ID where available, otherwise unique exact email. Ambiguous matches are unresolved. Group reporting is labelled as current membership; snapshots support observed history but cannot reconstruct uncaptured earlier changes.
- Explicit agent attachments are not effective permissions and do not prove invocation. Agents without attachments can still have access to dynamically available connectors. Invocation records without an agent ID remain unattributed.
- Audit pages show at most the latest 1,000 matching records in the selected period. Narrow the time window for busy accounts. S3 holds full captured CloudTrail history; no claim of complete historical search through the UI.
- Collection starts when enabled; no automatic historical backfill from existing trails. Quick usage delivery may be delayed. Last observed log activity and inventory sync health are displayed separately.
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

`Collection health` reports each source error and overdue inventory. CloudWatch includes Lambda error alarms and a custom collector-error metric; alarm notification subscriptions and AWS Budgets recipients are account-specific and should be configured by the account owner. This deployment does not create email/SMS subscriptions.

Repeat `npm run deploy -- config/account.local.json` for updates. For another account, copy the example configuration, supply its directory/group IDs, switch AWS_PROFILE, bootstrap that account/region, and deploy. Do not reuse this account's Cognito pool or SAML application in another account.

## Source provenance

Adapted from the `usage-monitor/` project in [CloudMile-Inc/amazon-quick-deployment-pack](https://github.com/CloudMile-Inc/amazon-quick-deployment-pack), commit `291cd91f6e8cf5385eed478108385f9bfef58658`. The upstream MIT-0 license is preserved in LICENSE. This fork adds Identity Center federation, directory/inventory collection, audit collection and category pages. Legacy documentation under docs/ describes the original monitor; this README takes precedence for this deployment.
