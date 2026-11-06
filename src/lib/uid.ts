let counter = 0;
export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
