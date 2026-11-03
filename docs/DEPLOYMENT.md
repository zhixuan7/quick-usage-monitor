# Deployment

See the [current deployment and SSO instructions](../README.md#deploy-to-an-aws-account).

The root `npm run deploy -- config/account.local.json` verifies the AWS account, builds the static dashboard and runs CDK. Configuration is deliberately per account. Do not deploy the original upstream instructions unchanged: this fork uses Identity Center federation rather than password-based Cognito accounts.
