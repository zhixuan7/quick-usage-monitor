# Configuration

Copy config/example.json to an ignored config/*.local.json file. Required keys: account, region, identityStoreId, identityCenterRegion and allowedGroupIds. Optional: stackName, quickRegions, logRetentionDays, archiveRetentionDays, syncMinutes, samlMetadataUrl or samlMetadataFile (mutually exclusive). File paths are resolved relative to the account configuration file. One monitor stack per account/region is supported.

Leaving both samlMetadataUrl and samlMetadataFile empty deploys collection and a sign-in page but cannot admit data users. Supply the metadata URL or downloaded XML from the Identity Center customer-managed SAML application and redeploy. Dashboard permissions are managed through the configured directory group IDs, not the inherited local-user management screen.
