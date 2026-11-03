import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';

const STATUS_PARAM = '/quick-usage-monitor/region-status';

export class QuickMonitorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const regions: string[] = this.node.tryGetContext('quickRegions') ?? ['us-east-1'];
    const retentionDays: number = this.node.tryGetContext('logRetentionDays') ?? 90;
    const identityStoreId: string = this.node.tryGetContext('identityStoreId');
    const identityRegion: string = this.node.tryGetContext('identityCenterRegion') ?? this.region;
    const metadataUrl: string = this.node.tryGetContext('samlMetadataUrl') ?? '';
    const syncMinutes: number = this.node.tryGetContext('syncMinutes') ?? 15;
    const allowedGroupIds: string[] = this.node.tryGetContext('allowedGroupIds');
    const dashboardUrl = () => `https://${distribution.distributionDomainName}`;


    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Rewrite /users -> /users/index.html for the static export
    const rewriteFn = new cloudfront.Function(this, 'UrlRewriteFn', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) { req.uri = uri + 'index.html'; }
  else if (!uri.includes('.')) { req.uri = uri + '/index.html'; }
  return req;
}`),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: rewriteFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'Quick Usage Monitor dashboard',
    });


    // ------------------------------------------------------------------
    // 1. Multi-region log pipeline provisioner (custom resource)
    // ------------------------------------------------------------------
    const provisionerFn = new NodejsFunction(this, 'ProvisionerFn', {
      entry: path.join(__dirname, '../lambda/provisioner/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: { bundleAwsSDK: true },
      timeout: cdk.Duration.minutes(10),
      memorySize: 256,
      description: 'Provisions Amazon Quick vended log pipelines in every configured region',
    });
    provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:PutRetentionPolicy',
          'logs:PutDeliverySource',
          'logs:PutDeliveryDestination',
          'logs:CreateDelivery',
          'logs:GetDelivery',
          'logs:DescribeDeliveries',
          'logs:DescribeDeliverySources',
          'logs:DescribeDeliveryDestinations',
          'logs:DeleteDelivery',
          'logs:DeleteDeliverySource',
          'logs:DeleteDeliveryDestination',
          'logs:PutDeliveryDestinationPolicy',
          'logs:GetDeliverySource',
          'logs:GetDeliveryDestination',
          'logs:GetDeliveryDestinationPolicy',
          'logs:AllowVendedLogDeliveryForResource',
          // CreateDelivery to a CWL destination updates the log group's
          // resource policy to allow delivery.logs.amazonaws.com
          'logs:PutResourcePolicy',
          'logs:DescribeResourcePolicies',
          'logs:DescribeLogGroups',
        ],
        resources: ['*'], // multi-region by design; scoped by action set
      }),
    );
    provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['quicksight:AllowVendedLogDeliveryForResource'],
        resources: [`arn:aws:quicksight:*:${this.account}:account/${this.account}`],
      }),
    );
    provisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:PutParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${STATUS_PARAM}`],
      }),
    );

    const provider = new cr.Provider(this, 'ProvisionerProvider', {
      onEventHandler: provisionerFn,
    });
    new cdk.CustomResource(this, 'RegionPipelines', {
      serviceToken: provider.serviceToken,
      properties: {
        Regions: regions,
        AccountId: this.account,
        RetentionDays: String(retentionDays),
        StatusParameterName: STATUS_PARAM,
        // Re-run the (idempotent) provisioner on every deploy so region
        // pipelines self-heal after permission or config fixes.
        Timestamp: Date.now().toString(),
      },
    });

    // ------------------------------------------------------------------
    // 2. Auth - Cognito user pool (dashboard exposes chat content)
    // ------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false, signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const domain = userPool.addDomain('SsoDomain', { cognitoDomain: { domainPrefix: `quick-monitor-${this.account}-${this.region}` } });
    const samlProvider = metadataUrl ? new cognito.UserPoolIdentityProviderSaml(this, 'IdentityCenter', {
      userPool, name: 'IdentityCenter', metadata: cognito.UserPoolIdentityProviderSamlMetadata.url(metadataUrl),
      attributeMapping: { email: cognito.ProviderAttribute.other('email') },
    }) : undefined;
    const userPoolClient = userPool.addClient('DashboardClient', {
      generateSecret: false, preventUserExistenceErrors: true,
      authFlows: { userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      supportedIdentityProviders: samlProvider ? [cognito.UserPoolClientIdentityProvider.custom('IdentityCenter')] : [],
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL], callbackUrls: [`${dashboardUrl()}/auth/callback/`], logoutUrls: [`${dashboardUrl()}/login/`] },
      idTokenValidity: cdk.Duration.hours(1), accessTokenValidity: cdk.Duration.hours(1),
    });
    if (samlProvider) userPoolClient.node.addDependency(samlProvider);

    const inventory = new dynamodb.Table(this, 'InventoryTable', {
      partitionKey: {name:'pk',type:dynamodb.AttributeType.STRING}, sortKey:{name:'sk',type:dynamodb.AttributeType.STRING},
      billingMode:dynamodb.BillingMode.PAY_PER_REQUEST, timeToLiveAttribute:'ttl', removalPolicy:cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification:{pointInTimeRecoveryEnabled:true},
    });
    const auditLogs = new logs.LogGroup(this, 'AuditLogs', {retention:retentionDays,removalPolicy:cdk.RemovalPolicy.RETAIN});
    const auditBucket = new s3.Bucket(this,'AuditArchive',{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,encryption:s3.BucketEncryption.S3_MANAGED,enforceSSL:true,removalPolicy:cdk.RemovalPolicy.RETAIN,lifecycleRules:[{expiration:cdk.Duration.days(this.node.tryGetContext('archiveRetentionDays') ?? 365)}]});
    // Dedicated trail preserves existing trails/selectors. Additional management copy is billable.
    const auditTrail = new cloudtrail.Trail(this,'AuditTrail',{isMultiRegionTrail:true,includeGlobalServiceEvents:true,bucket:auditBucket,sendToCloudWatchLogs:true,cloudWatchLogGroup:auditLogs,enableFileValidation:true});
    const cfnTrail = auditTrail.node.defaultChild as cloudtrail.CfnTrail;
    cfnTrail.eventSelectors = undefined;
    cfnTrail.advancedEventSelectors = [
      {name:'Management audit',fieldSelectors:[{field:'eventCategory',equalTo:['Management']}]},
      {name:'Quick connector invocations',fieldSelectors:[{field:'eventCategory',equalTo:['Data']},{field:'resources.type',equalTo:['AWS::Quicksight::ActionConnector']}]},
    ];
    const collector = new NodejsFunction(this,'InventoryCollector',{
      entry:path.join(__dirname,'../lambda/collector/index.ts'),runtime:lambda.Runtime.NODEJS_22_X,bundling:{bundleAwsSDK:true},timeout:cdk.Duration.minutes(10),memorySize:512,
      environment:{INVENTORY_TABLE:inventory.tableName,ACCOUNT_ID:this.account,IDENTITY_REGION:identityRegion,IDENTITY_STORE_ID:identityStoreId,QUICK_REGIONS:JSON.stringify(regions)},
    });
    inventory.grantReadWriteData(collector);
    collector.addToRolePolicy(new iam.PolicyStatement({actions:['identitystore:ListUsers','identitystore:ListGroups','identitystore:ListGroupMemberships'],resources:['*']}));
    collector.addToRolePolicy(new iam.PolicyStatement({actions:['quicksight:ListNamespaces','quicksight:ListUsers','quicksight:ListAgents','quicksight:DescribeAgent','quicksight:DescribeAgentPermissions','quicksight:ListActionConnectors','quicksight:DescribeActionConnector','quicksight:DescribeActionConnectorPermissions'],resources:['*']}));
    new events.Rule(this,'InventorySchedule',{schedule:events.Schedule.rate(cdk.Duration.minutes(syncMinutes)),targets:[new targets.LambdaFunction(collector,{retryAttempts:2})]});
    new logs.MetricFilter(this,'CollectorErrors',{logGroup:collector.logGroup,filterPattern:logs.FilterPattern.literal('{ $.status = "partial" }'),metricNamespace:'QuickMonitor',metricName:'CollectionErrors',metricValue:'1'});
    collector.metricErrors().createAlarm(this,'CollectorFailureAlarm',{threshold:1,evaluationPeriods:1});
    new cr.AwsCustomResource(this,'InitialInventory',{
      installLatestAwsSdk:false,
      onCreate:{service:'Lambda',action:'invoke',parameters:{FunctionName:collector.functionName,InvocationType:'Event'},physicalResourceId:cr.PhysicalResourceId.of('initial-inventory')},
      policy:cr.AwsCustomResourcePolicy.fromSdkCalls({resources:[collector.functionArn]}),
    });
    new cdk.CfnOutput(this,'CollectorFunction',{value:collector.functionName});
    new cdk.CfnOutput(this,'InventoryTableName',{value:inventory.tableName});
    new cdk.CfnOutput(this,'SamlEntityId',{value:`urn:amazon:cognito:sp:${userPool.userPoolId}`});
    new cdk.CfnOutput(this,'SamlAcsUrl',{value:`https://${domain.domainName}.auth.${this.region}.amazoncognito.com/saml2/idpresponse`});
    new cdk.CfnOutput(this,'SsoConfigured',{value:String(Boolean(metadataUrl))});
    new cdk.CfnOutput(this,'AuditLogGroup',{value:auditLogs.logGroupName});

    // ------------------------------------------------------------------
    // 3. Query cache
    // ------------------------------------------------------------------
    const cacheTable = new dynamodb.Table(this, 'CacheTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ------------------------------------------------------------------
    // 4. API - Lambda + HTTP API with JWT authorizer
    // ------------------------------------------------------------------
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: { bundleAwsSDK: true },
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      description: 'Quick Usage Monitor API - cross-region Logs Insights aggregation',
      environment: {
        CACHE_TABLE: cacheTable.tableName,
        STATUS_PARAM,
        CACHE_TTL_SECONDS: '300',
        USER_POOL_ID: userPool.userPoolId,
        INVENTORY_TABLE: inventory.tableName,
        IDENTITY_REGION: identityRegion,
        IDENTITY_STORE_ID: identityStoreId,
        ALLOWED_GROUP_IDS: JSON.stringify(allowedGroupIds),
        QUICK_REGIONS: JSON.stringify(regions),
        SYNC_MINUTES: String(syncMinutes),
        AUDIT_LOG_GROUP: auditLogs.logGroupName,
      },
    });
    cacheTable.grantReadWriteData(apiFn);
    inventory.grantReadData(apiFn);
    auditLogs.grantRead(apiFn);
    apiFn.addToRolePolicy(new iam.PolicyStatement({actions:['identitystore:ListGroupMembershipsForMember'],resources:['*']}));
    apiFn.addToRolePolicy(new iam.PolicyStatement({actions:['logs:DescribeLogStreams'],resources:[`arn:aws:logs:*:${this.account}:log-group:/aws/vendedlogs/quick-monitor/*`]}));
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['logs:StartQuery', 'logs:GetQueryResults', 'logs:StopQuery'],
        resources: [
          `arn:aws:logs:*:${this.account}:log-group:/aws/vendedlogs/quick-monitor/*`,
          `arn:aws:logs:*:${this.account}:log-group:/aws/vendedlogs/quick-monitor/*:*`,
        ],
      }),
    );
    // GetQueryResults is not resource-scoped in some regions; keep a narrow fallback
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['logs:GetQueryResults'],
        resources: ['*'],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${STATUS_PARAM}`],
      }),
    );

    const authorizer = new HttpJwtAuthorizer(
      'JwtAuth',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'quick-usage-monitor',
      corsPreflight: {
        allowOrigins: [dashboardUrl()],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.hours(1),
      },
      defaultAuthorizer: authorizer,
    });
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [
        apigwv2.HttpMethod.GET,
      ],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFn),
    });

    // ------------------------------------------------------------------
    // 5. Frontend - S3 + CloudFront static hosting for the Next.js export
    // ------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'SiteDeployment', {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../frontend/out')),
        // Runtime config consumed by the frontend at load time
        s3deploy.Source.jsonData('config.json', {
          apiUrl: httpApi.apiEndpoint,
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
          authDomain: `https://${domain.domainName}.auth.${this.region}.amazoncognito.com`,
          ssoConfigured: Boolean(metadataUrl),
          accountId: this.account,
        }),
      ],
    });

    // ------------------------------------------------------------------
    // Outputs
    // ------------------------------------------------------------------
    new cdk.CfnOutput(this, 'DashboardUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'MonitoredRegions', { value: regions.join(', ') });
  }
}
