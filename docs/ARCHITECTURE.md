# Architecture

- Company login: Entra ID → existing IAM Identity Center → customer-managed SAML application → Cognito authorization code + PKCE → API Gateway JWT authorizer.
- Every API request additionally resolves the signed email assertion to one synchronized directory identity, then checks current Identity Center membership against the configured monitoring groups. Non-federated users, unknown identities and removed group members are denied.
- Quick log deliveries stay regional. Existing delivery sources are reused; separate monitor destinations avoid overwriting existing integrations.
- A dedicated multi-region CloudTrail trail captures management and ActionConnector data events, retaining existing trails unchanged. It delivers to an encrypted private S3 archive and a CloudWatch log group.
- Scheduled inventory uses public Identity Store and Quick APIs. DynamoDB stores current items and versioned observations; source failures preserve existing items. Snapshot timestamps are not exact change timestamps.
- Dashboard queries read inventory and Logs Insights. Errors and missing sources are surfaced. Audit result sets are limited to 1,000 newest events; S3 retains full captured audit logs.

See [README](../README.md) for limits, retention and setup.
