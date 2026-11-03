export interface TokenClaims {
  username: string;
  email?: string;
  groups: string[];
}
export function getToken(): string | null {
  if (process.env.NEXT_PUBLIC_MOCK === "1") return "mock-token";
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem("qum.idToken");
  return token && Date.now() < Number(sessionStorage.getItem("qum.expiry") ?? 0)
    ? token
    : null;
}
export function signOut() {
  sessionStorage.removeItem("qum.idToken");
  sessionStorage.removeItem("qum.expiry");
}
export function getClaims(): TokenClaims | null {
  const token = getToken();
  if (!token) return null;
  try {
    const p = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return {
      username: p.email ?? p["cognito:username"] ?? "",
      email: p.email,
      groups: [],
    };
  } catch {
    return null;
  }
}
export function isAdmin() {
  return false;
}
