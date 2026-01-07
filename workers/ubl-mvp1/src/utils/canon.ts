/**
 * UBL MVP-1 Canonicalization Module
 * Implements strict canonical JSON serialization for deterministic hashing.
 *
 * Rules (from Blueprint):
 * - UTF-8 encoding
 * - Object keys sorted lexicographically
 * - No insignificant whitespace
 * - Numbers rendered consistently (minimal representation)
 * - Unicode normalized (NFC)
 * - Line endings normalized (\r\n → \n)
 * - No -0, NaN, or Infinity values
 */

/**
 * Sorts object keys lexicographically (Unicode code point order)
 */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sortedKeys = Object.keys(obj).sort((a, b) => {
    // Lexicographic comparison using Unicode code points
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const codeA = a.charCodeAt(i);
      const codeB = b.charCodeAt(i);
      if (codeA !== codeB) {
        return codeA - codeB;
      }
    }
    return a.length - b.length;
  });

  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = obj[key];
  }
  return result;
}

/**
 * Normalizes a number to its minimal JSON representation.
 * Handles edge cases like -0, NaN, Infinity.
 */
function normalizeNumber(num: number): number | null {
  // Reject NaN and Infinity
  if (!Number.isFinite(num)) {
    throw new Error(`Cannot canonicalize non-finite number: ${num}`);
  }

  // Convert -0 to 0
  if (Object.is(num, -0)) {
    return 0;
  }

  return num;
}

/**
 * Normalizes a string value.
 * - Applies Unicode NFC normalization
 * - Normalizes line endings (\r\n → \n, standalone \r → \n)
 */
function normalizeString(str: string): string {
  // Normalize Unicode to NFC form
  let normalized = str.normalize('NFC');

  // Normalize line endings: \r\n → \n, then \r → \n
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return normalized;
}

/**
 * Recursively processes a value for canonical serialization.
 * Returns a new value with all transformations applied.
 */
function canonicalizeValue(value: unknown): unknown {
  // Handle null
  if (value === null) {
    return null;
  }

  // Handle undefined - exclude from output
  if (value === undefined) {
    return undefined;
  }

  // Handle primitive types
  switch (typeof value) {
    case 'boolean':
      return value;

    case 'number':
      return normalizeNumber(value);

    case 'string':
      return normalizeString(value);

    case 'object':
      // Handle arrays
      if (Array.isArray(value)) {
        return value.map(item => canonicalizeValue(item));
      }

      // Handle objects
      const obj = value as Record<string, unknown>;
      const sorted = sortObjectKeys(obj);
      const result: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(sorted)) {
        // Skip undefined values (they shouldn't appear in JSON)
        if (val !== undefined) {
          const normalizedKey = normalizeString(key);
          result[normalizedKey] = canonicalizeValue(val);
        }
      }

      return result;

    default:
      throw new Error(`Cannot canonicalize value of type: ${typeof value}`);
  }
}

/**
 * Serializes a value to canonical JSON string.
 * No whitespace, sorted keys, normalized values.
 */
function serializeCanonical(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return '';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      // Use standard JSON number serialization
      return JSON.stringify(value);

    case 'string':
      // Use JSON string serialization for proper escaping
      return JSON.stringify(value);

    case 'object':
      if (Array.isArray(value)) {
        const items = value.map(item => serializeCanonical(item));
        return '[' + items.join(',') + ']';
      }

      const obj = value as Record<string, unknown>;
      const pairs: string[] = [];

      for (const [key, val] of Object.entries(obj)) {
        if (val !== undefined) {
          const serializedKey = JSON.stringify(key);
          const serializedValue = serializeCanonical(val);
          pairs.push(serializedKey + ':' + serializedValue);
        }
      }

      return '{' + pairs.join(',') + '}';

    default:
      throw new Error(`Cannot serialize value of type: ${typeof value}`);
  }
}

/**
 * Main canonicalization function.
 * Takes any JSON-serializable object and returns a deterministic canonical JSON string.
 *
 * @param obj - The object to canonicalize
 * @returns Canonical JSON string
 */
export function canonicalizeJSON(obj: unknown): string {
  const canonicalized = canonicalizeValue(obj);
  return serializeCanonical(canonicalized);
}

/**
 * Creates a copy of an object with a specific field removed.
 * Used for computing CID (which excludes the CID field itself).
 *
 * @param obj - The object to copy
 * @param fieldToRemove - The field to exclude
 * @returns New object without the specified field
 */
export function removeField<T extends Record<string, unknown>>(
  obj: T,
  fieldToRemove: keyof T
): Omit<T, typeof fieldToRemove> {
  const { [fieldToRemove]: _, ...rest } = obj;
  return rest as Omit<T, typeof fieldToRemove>;
}

/**
 * Validates that an object can be canonicalized.
 * Throws if the object contains non-serializable values.
 *
 * @param obj - The object to validate
 * @throws Error if object cannot be canonicalized
 */
export function validateCanonicalizable(obj: unknown): void {
  try {
    canonicalizeJSON(obj);
  } catch (error) {
    throw new Error(`Object cannot be canonicalized: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Compares two objects for canonical equality.
 * Two objects are canonically equal if their canonical JSON representations are identical.
 *
 * @param a - First object
 * @param b - Second object
 * @returns true if objects are canonically equal
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalizeJSON(a) === canonicalizeJSON(b);
}
