const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://embed.tawk.to https://*.tawk.to https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.tawk.to",
  "font-src 'self' data: https://fonts.gstatic.com https://*.tawk.to",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.tawk.to wss://*.tawk.to https://api.elevenlabs.io",
  "frame-src https://*.tawk.to https://js.stripe.com https://checkout.stripe.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Menu import sends PDFs (up to ~3 MB) to a server action. The default
    // 1 MB limit would reject them; Vercel caps requests at 4.5 MB anyway.
    serverActions: { bodySizeLimit: "4mb" },
  },
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
          // Content Security Policy in REPORT-ONLY mode: browsers log what
          // it would block (in the console) but block nothing, so no widget
          // can break. Once the console stays clean on every page with a
          // widget (Tawk.to chat, Stripe, fonts), switch the key to
          // "Content-Security-Policy" to enforce it.
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
