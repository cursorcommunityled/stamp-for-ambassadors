import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Covers are plain `<img>` tags through src/components/plate.tsx, and every
 * one Luma has handed us so far is on images.lumacdn.com. cdn.lu.ma is their
 * other asset host, allowed so a change on their side does not blank the
 * covers on every event page at once. `data:` is for the grain texture in
 * globals.css, which is an inline SVG.
 *
 * `script-src 'unsafe-inline'`: layout.tsx sets the theme class before paint
 * with an inline script, and Next's own bootstrap is inline too. Both want a
 * nonce, which wants a proxy and dynamic rendering on every page. That is a
 * change of its own, not a rider on this one, so the honest description is
 * that this CSP is about framing, form targets, and where assets may come
 * from — not about defeating a script injection.
 *
 * Dev adds 'unsafe-eval' for React's error overlay and websockets for HMR.
 */
const csp = [
  "default-src 'self'",
  "img-src 'self' data: https://images.lumacdn.com https://cdn.lu.ma",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // The test suite runs its own dev server next to yours, and Next allows one
  // per output directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Nothing gains from announcing the framework and version to a scanner.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Admin pages are plain form posts, so framing is worth refusing
          // twice: this for older browsers, frame-ancestors for the rest.
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Magic links arrive over whatever the mail client opens. Held for
          // two years with preload eligibility, and only in production: over
          // plain http a browser ignores it, but saying it there is noise.
          ...(isDev
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]),
        ],
      },
    ];
  },
};

export default nextConfig;
