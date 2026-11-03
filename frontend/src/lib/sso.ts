import { getConfig } from "./config";
const to64 = (v: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(v)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export async function startSso() {
  const cfg = await getConfig();
  if (!cfg.ssoConfigured || !cfg.authDomain)
    throw new Error(
      "SSO application setup is pending. Contact your dashboard administrator.",
    );
  const verifier = to64(crypto.getRandomValues(new Uint8Array(48)));
  const state = to64(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem("sso.verifier", verifier);
  sessionStorage.setItem("sso.state", state);
  const challenge = to64(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const q = new URLSearchParams({
    client_id: cfg.userPoolClientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: `${location.origin}/auth/callback/`,
    identity_provider: "IdentityCenter",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  location.assign(`${cfg.authDomain}/oauth2/authorize?${q}`);
}
export async function completeSso() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  const state = q.get("state");
  if (!state || state !== sessionStorage.getItem("sso.state"))
    throw new Error("Invalid sign-in state. Start sign-in again.");
  const verifier = sessionStorage.getItem("sso.verifier");
  sessionStorage.removeItem("sso.state");
  sessionStorage.removeItem("sso.verifier");
  history.replaceState(null, "", "/auth/callback/");
  if (!code || !verifier)
    throw new Error(q.get("error_description") ?? "Missing authorization code");
  const cfg = await getConfig();
  const res = await fetch(`${cfg.authDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.userPoolClientId,
      code,
      redirect_uri: `${location.origin}/auth/callback/`,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error("Sign-in token exchange failed");
  const tokens = await res.json();
  sessionStorage.setItem("qum.idToken", tokens.id_token);
  sessionStorage.setItem(
    "qum.expiry",
    String(Date.now() + tokens.expires_in * 1000),
  );
  location.replace("/");
}
export async function logoutSso() {
  const cfg = await getConfig();
  sessionStorage.clear();
  if (cfg.authDomain)
    location.assign(
      `${cfg.authDomain}/logout?${new URLSearchParams({ client_id: cfg.userPoolClientId, logout_uri: `${location.origin}/login/` })}`,
    );
  else location.assign("/login/");
}
