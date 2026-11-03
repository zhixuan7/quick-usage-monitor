# Troubleshooting

- SSO pending: complete README federation steps and redeploy the same account configuration.
- API 401: expired/missing Cognito ID token; sign in again.
- API 403: verify SAML email mapping, successful directory sync, unique identity email and membership of allowedGroupIds.
- Empty usage: delivery is not retroactive. Check Collection health and Region pipelines.
- Partial sync: Collection health identifies the failed source; check collector CloudWatch logs. A failed source does not replace its inventory with an empty list.
- Query timeout: select a shorter period. The API reports timeout rather than treating it as zero activity.
- Missing old events: existing trail archives are not automatically backfilled; this stack's collection starts at deployment.
