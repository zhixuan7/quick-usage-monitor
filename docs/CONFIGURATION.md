# Configuration

Copy config/example.json to an ignored config/*.local.json file. Required keys: account, region, identityStoreId, identityCenterRegion and allowedGroupIds. Optional: stackName, quickRegions, logRetentionDays, archiveRetentionDays, syncMinutes, samlMetadataUrl. One monitor stack per account/region is supported.

An empty samlMetadataUrl deploys collection and a sign-in page but cannot admit data users. Fill the metadata URL from the Identity Center customer-managed SAML application and redeploy. Dashboard permissions are managed through the configured directory group IDs, not the inherited local-user management screen.
