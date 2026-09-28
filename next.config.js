/** @type {import('next').NextConfig} */
const nextConfig = {
  // Baseline security headers — applied to every response. No CSP here
  // on purpose: this app loads several third-party widgets (Stripe,
  // Tawk.to, ElevenLabs, Google Fonts) and a blind CSP is more likely
  // to silently break one of those than to add real protection; a CSP
  // should be added deliberately later, tuned to the exact hosts in
  // use, and tested against every page that embeds a widget.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevents this site's pages from being embedded in an
          // <iframe> on another origin (clickjacking).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Stops the browser from guessing content types away from
          // what the server declared (MIME-sniffing based attacks).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Sends the full referrer only to our own origin; a bare
          // origin (no path/query) to other sites, none over plain
          // HTTP.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Denies camera/mic/location by default — none of this app's
          // own pages need them; a future feature that does can opt
          // back in for its own route.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Forces HTTPS on repeat visits. Vercel already serves HTTPS
          // only, so this has no behavior change today — it just tells
          // browsers to stop trying plain HTTP for this host at all,
          // closing the one-time-downgrade window.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
