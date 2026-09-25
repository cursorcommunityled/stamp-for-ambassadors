/**
 * City-level copy. One deploy is one ambassador night, so these are env
 * strings rather than a tenant table. A shared site that runs many cities
 * is a later branch; do not grow this file into that.
 */

export function appName(): string {
  return process.env.APP_NAME?.trim() || "Stamp";
}

export function appTagline(): string {
  return process.env.APP_TAGLINE?.trim() || "Show up. Get stamped.";
}

export function footerCredit(): string {
  return (
    process.env.FOOTER_CREDIT?.trim() ||
    "Stamp · Cursor Community Led"
  );
}
