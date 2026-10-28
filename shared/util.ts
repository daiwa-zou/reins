// Small input-normalising helpers the pure shared modules share.

/** A trimmed string, or "" for anything that is not a string. */
export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A plain object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
