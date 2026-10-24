import { createHash } from 'crypto';

/**
 * Generates a SHA-256 hash of the payload with keys sorted recursively.
 * This ensures that key ordering variations in the JSON do not produce
 * different hashes for semantically identical payloads.
 */
export function generateCanonicalPayloadHash(payload: Record<string, unknown>): string {
  const sortKeys = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortKeys);
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce(
        (acc: Record<string, unknown>, key: string) => {
          acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
          return acc;
        },
        {} as Record<string, unknown>,
      );
  };

  const canonicalJson = JSON.stringify(sortKeys(payload));
  return createHash('sha256').update(canonicalJson).digest('hex');
}
