let fallbackSequence = 0;

function secureToken(): string | null {
  const crypto = globalThis.crypto;
  const uuid = crypto?.randomUUID?.();
  if (uuid) return uuid;

  if (crypto?.getRandomValues) {
    const values = crypto.getRandomValues(new Uint32Array(4));
    return [...values]
      .map((value) => value.toString(36).padStart(7, "0"))
      .join("-");
  }

  return null;
}

export function createRuntimeId(prefix?: string): string {
  const token = secureToken();
  if (token) return prefix ? `${prefix}-${token}` : token;

  fallbackSequence += 1;
  const timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
  const fallback = [
    Math.trunc(timeOrigin).toString(36),
    Date.now().toString(36),
    fallbackSequence.toString(36),
  ].join("-");
  return prefix ? `${prefix}-${fallback}` : fallback;
}
