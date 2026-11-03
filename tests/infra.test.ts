import { test } from "node:test";
import assert from "node:assert/strict";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { QuickMonitorStack } from "../infra/lib/quick-monitor-stack";

test("stack uses federation, private origin, protected GET API and connector data audit", () => {
  const app = new cdk.App({
    context: {
      quickRegions: ["ap-southeast-2"],
      identityStoreId: "d-1234567890",
      identityCenterRegion: "ap-southeast-2",
      allowedGroupIds: ["admin-group"],
      samlMetadataUrl: "https://example.com/metadata.xml",
    },
  });
  const stack = new QuickMonitorStack(app, "TestMonitor", {
    env: { account: "123456789012", region: "ap-southeast-2" },
  });
  const t = Template.fromStack(stack);
  t.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
    ProviderName: "IdentityCenter",
    ProviderType: "SAML",
  });
  t.hasResourceProperties("AWS::Cognito::UserPoolClient", {
    GenerateSecret: false,
    AllowedOAuthFlows: ["code"],
    SupportedIdentityProviders: ["IdentityCenter"],
  });
  t.hasResourceProperties("AWS::ApiGatewayV2::Route", {
    AuthorizationType: "JWT",
    RouteKey: "GET /api/{proxy+}",
  });
  t.resourceCountIs("AWS::Cognito::UserPoolUser", 0);
  t.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
  const trails = Object.values(
    t.findResources("AWS::CloudTrail::Trail"),
  ) as any[];
  assert.ok(
    trails[0].Properties.AdvancedEventSelectors.some((s: any) =>
      s.FieldSelectors.some(
        (f: any) =>
          f.Field === "resources.type" &&
          f.Equals.includes("AWS::Quicksight::ActionConnector"),
      ),
    ),
  );
  const policies = JSON.stringify(t.findResources("AWS::IAM::Policy"));
  assert.ok(!policies.includes("cognito-idp:AdminCreateUser"));
  assert.ok(policies.includes("lambda:InvokeFunction"));
  assert.ok(!policies.includes('\"lambda:Invoke\"'));
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("downloaded SAML metadata activates federation without publishing a URL", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "quick-monitor-saml-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const metadata =
    '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" /></EntityDescriptor>';
  const file = join(dir, "metadata.xml");
  writeFileSync(file, metadata);
  const app = new cdk.App({
    context: {
      quickRegions: ["ap-southeast-2"],
      identityStoreId: "d-1234567890",
      allowedGroupIds: ["admin-group"],
      samlMetadataFile: file,
    },
  });
  const stack = new QuickMonitorStack(app, "FileMetadataMonitor", {
    env: { account: "123456789012", region: "ap-southeast-2" },
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", {
    ProviderName: "IdentityCenter",
    ProviderDetails: { MetadataFile: metadata },
  });
  template.hasOutput("SsoConfigured", { Value: "true" });
});
