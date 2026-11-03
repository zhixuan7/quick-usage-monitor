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

export function isServiceEvidence(message: string | undefined): boolean {
  const value = parseEvidence(message);
  return Boolean(
    value &&
    (value.log_type ||
      value.logType ||
      value.user_arn ||
      value.event_name ||
      value.event_timestamp),
  );
}
