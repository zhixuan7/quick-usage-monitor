/** Delivery permission-check messages are not service audit records. */
export function parseEvidence(
  message: string | undefined,
): Record<string, any> | null {
  try {
    const value = JSON.parse(message ?? "");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
