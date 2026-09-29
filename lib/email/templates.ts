/**
 * Shared branded shell for every transactional email HavnLine sends via
 * Resend. Table-based layout with every style inlined — Gmail, Outlook
 * and most mobile mail clients strip or mangle <style> blocks, so this
 * is the one layout that reliably renders the same everywhere. Keep it
 * this way rather than "cleaning it up" with classes/<style>.
 *
 * Colors match tailwind.config.ts (ink/brand/text/border) so email and
 * dashboard look like the same product.
 */

export interface EmailRow {
  label: string;
  value: string;
}

export interface EmailLayoutOptions {
  /** Short hidden preview text shown next to the subject in inbox lists. */
  preheader: string;
  /** Big heading at the top of the email body. */
  heading: string;
  /** One or two sentences under the heading, plain text (HTML-escaped by caller if needed). */
  intro: string;
  /** Label/value rows rendered as a bordered info card (e.g. Caller, Phone, Reason). */
  rows?: EmailRow[];
  /** Primary call-to-action button. */
  cta?: { label: string; url: string };
  /** Shown small and muted at the very bottom (e.g. why they're getting this + a settings link). */
  footerNote: string;
}

const COLORS = {
  ink: "#0B1220",
  paper: "#F6F7FA",
  card: "#FFFFFF",
  border: "#E5E7EB",
  borderSoft: "#EEF0F3",
  textMuted: "#5B6472",
  textFaint: "#9AA3B2",
  brand: "#2563EB",
  brandSoft: "#E9F0FE",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const rowsHtml = (opts.rows || [])
    .map(
      (row, i) => `
        <tr>
          <td style="padding: 10px 16px; ${i > 0 ? `border-top: 1px solid ${COLORS.borderSoft};` : ""} font-size: 13px; color: ${COLORS.textMuted}; width: 88px; vertical-align: top;">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding: 10px 16px; ${i > 0 ? `border-top: 1px solid ${COLORS.borderSoft};` : ""} font-size: 14px; color: ${COLORS.ink}; font-weight: 500;">
            ${row.value}
          </td>
        </tr>`
    )
    .join("");

  const ctaHtml = opts.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px 0 4px;">
        <tr>
          <td style="border-radius: 10px; background: ${COLORS.brand};">
            <a href="${escapeHtml(opts.cta.url)}" style="display: inline-block; padding: 12px 22px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none;">
              ${escapeHtml(opts.cta.label)} &rarr;
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HavnLine</title>
  </head>
  <body style="margin: 0; padding: 0; background: ${COLORS.paper}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(opts.preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${COLORS.paper};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px;">

            <!-- Wordmark -->
            <tr>
              <td style="padding: 0 4px 20px;">
                <span style="font-size: 17px; font-weight: 700; color: ${COLORS.ink}; letter-spacing: -0.01em;">Havn<span style="color: ${COLORS.brand};">Line</span></span>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background: ${COLORS.card}; border: 1px solid ${COLORS.border}; border-radius: 14px; padding: 28px;">
                <h1 style="margin: 0 0 10px; font-size: 19px; line-height: 1.35; color: ${COLORS.ink}; font-weight: 700;">
                  ${escapeHtml(opts.heading)}
                </h1>
                <p style="margin: 0; font-size: 14.5px; line-height: 1.6; color: ${COLORS.textMuted};">
                  ${opts.intro}
                </p>

                ${
                  rowsHtml
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 18px; background: ${COLORS.paper}; border: 1px solid ${COLORS.borderSoft}; border-radius: 10px;">${rowsHtml}</table>`
                    : ""
                }

                ${ctaHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding: 20px 4px 0;">
                <p style="margin: 0; font-size: 12px; line-height: 1.6; color: ${COLORS.textFaint};">
                  ${opts.footerNote}
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
