/**
 * Admin panel backing module: Cognito user management + per-user frontend
 * permissions.
 *
 * - Dashboard users live in the Cognito user pool (invite / resend invite /
 *   reset password / delete are Cognito admin APIs).
 * - Per-user permissions are stored in the DynamoDB table used for the query
 *   cache, under pk = "perm#<username>" with no TTL so they never expire.
 * - Members of the "admins" Cognito group always have full access and are the
 *   only callers allowed to reach these functions (enforced in index.ts).
 */
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminResetUserPasswordCommand,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USER_POOL_ID = process.env.USER_POOL_ID!;
const CACHE_TABLE = process.env.CACHE_TABLE!;

export const ADMIN_GROUP = 'admins';

/** Feature toggles an admin can turn on/off per user. */
export const PERMISSION_KEYS = ['dashboard', 'users', 'chatLogs', 'storage', 'kbSync', 'regions', 'reports'] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type Permissions = Record<PermissionKey, boolean>;

export const FULL_ACCESS: Permissions = {
  dashboard: true,
  users: true,
  chatLogs: true,
  storage: true,
  kbSync: true,
  regions: true,
  reports: true,
};

const permKey = (username: string) => `perm#${username}`;

/** Stored permissions merged over full-access defaults (absent = allowed). */
export async function getPermissions(username: string): Promise<Permissions> {
  if (!username) return { ...FULL_ACCESS };
  const res = await ddb.send(
    new GetCommand({ TableName: CACHE_TABLE, Key: { pk: permKey(username) } }),
  );
  const stored = (res.Item?.permissions ?? {}) as Partial<Permissions>;
  return { ...FULL_ACCESS, ...stored };
}

export async function setPermissions(username: string, input: unknown): Promise<Permissions> {
  const admins = await adminUsernames();
  if (admins.has(username)) {
    throw new AdminError(400, 'Admins always have full access; their permissions cannot be changed.');
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  const permissions = { ...FULL_ACCESS };
  for (const key of PERMISSION_KEYS) {
    if (typeof raw[key] === 'boolean') permissions[key] = raw[key] as boolean;
  }
  await ddb.send(
    new PutCommand({
      TableName: CACHE_TABLE,
      Item: { pk: permKey(username), permissions, updatedAt: new Date().toISOString() },
    }),
  );
  return permissions;
}

/** Error with an HTTP status the route handler can surface to the admin UI. */
export class AdminError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

async function adminUsernames(): Promise<Set<string>> {
  const out = new Set<string>();
  let token: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: ADMIN_GROUP, NextToken: token }),
    );
    for (const u of res.Users ?? []) if (u.Username) out.add(u.Username);
    token = res.NextToken;
  } while (token);
  return out;
}

export interface DashboardUser {
  username: string;
  email: string;
  status: string;
  enabled: boolean;
  created: string;
  isAdmin: boolean;
  permissions: Permissions;
}

export async function listDashboardUsers(): Promise<DashboardUser[]> {
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersCommand({ UserPoolId: USER_POOL_ID, PaginationToken: token }),
    );
    users.push(...(res.Users ?? []));
    token = res.PaginationToken;
  } while (token);

  const admins = await adminUsernames();
  const rows = await Promise.all(
    users.map(async (u): Promise<DashboardUser> => {
      const username = u.Username ?? '';
      const isAdmin = admins.has(username);
      return {
        username,
        email: u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '',
        status: u.UserStatus ?? 'UNKNOWN',
        enabled: u.Enabled ?? true,
        created: u.UserCreateDate?.toISOString() ?? '',
        isAdmin,
        permissions: isAdmin ? { ...FULL_ACCESS } : await getPermissions(username),
      };
    }),
  );
  return rows.sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * Invite a new dashboard user by email. The pool uses email as a sign-in
 * alias, so the username must not be email-formatted: derive it from the
 * local part of the address. Cognito emails a temporary password.
 */
export async function inviteUser(email: string): Promise<DashboardUser> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AdminError(400, 'Enter a valid email address.');
  }
  const username = normalized.split('@')[0].replace(/[^a-z0-9._-]/g, '') || `user${Date.now()}`;
  try {
    const res = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [
          { Name: 'email', Value: normalized },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    const u = res.User;
    return {
      username: u?.Username ?? username,
      email: normalized,
      status: u?.UserStatus ?? 'FORCE_CHANGE_PASSWORD',
      enabled: u?.Enabled ?? true,
      created: u?.UserCreateDate?.toISOString() ?? new Date().toISOString(),
      isAdmin: false,
      permissions: { ...FULL_ACCESS },
    };
  } catch (err) {
    throw mapCognitoError(err, `A user named "${username}" already exists. Delete it first or use a different email.`);
  }
}

/** Re-send the invitation email (only valid while the invite is pending). */
export async function resendInvite(username: string): Promise<void> {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
  } catch (err) {
    throw mapCognitoError(err);
  }
}

/** Email the user a reset code; their current password stops working. */
export async function resetPassword(username: string): Promise<void> {
  try {
    await cognito.send(
      new AdminResetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: username }),
    );
  } catch (err) {
    throw mapCognitoError(err);
  }
}

export async function deleteUser(username: string, callerUsername: string): Promise<void> {
  if (username === callerUsername) {
    throw new AdminError(400, 'You cannot delete your own account.');
  }
  const admins = await adminUsernames();
  if (admins.has(username)) {
    throw new AdminError(400, 'Admin users cannot be deleted from the dashboard.');
  }
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  } catch (err) {
    throw mapCognitoError(err);
  }
  // Clean up the stored permissions record
  await ddb.send(new DeleteCommand({ TableName: CACHE_TABLE, Key: { pk: permKey(username) } }));
}

function mapCognitoError(err: unknown, existsMessage?: string): Error {
  const e = err as { name?: string; message?: string };
  switch (e.name) {
    case 'UsernameExistsException':
      return new AdminError(409, existsMessage ?? 'That user already exists.');
    case 'UserNotFoundException':
      return new AdminError(404, 'User not found.');
    case 'InvalidParameterException':
    case 'NotAuthorizedException':
    case 'UnsupportedUserStateException':
      return new AdminError(400, e.message ?? 'Invalid request.');
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return new AdminError(429, 'Too many requests; try again shortly.');
    default:
      return err as Error;
  }
}
