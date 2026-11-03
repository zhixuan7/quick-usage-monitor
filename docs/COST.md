# Cost

This enhanced version incurs costs for CloudWatch log ingestion/storage/scans, a dedicated multi-region CloudTrail trail (including an additional management-event copy if another trail already exists), connector data events, a 15-minute inventory Lambda schedule, DynamoDB snapshots/PITR, CloudFront/S3, API Gateway and Cognito SAML federation. Prices depend on region and event volume. The upstream near-zero-idle estimate is not a budget for this enhanced stack.

Configure retention, keep Quick regions intentional, use short query ranges, and configure AWS Budgets with an account-owner notification recipient. No notification emails or budget recipients are created automatically.
