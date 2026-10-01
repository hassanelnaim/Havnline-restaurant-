// The HavnLine web app's own URL — same backend the dashboard and the
// AI receptionist already talk to. One company, one backend, so this
// is a build-time constant rather than something the restaurant has to
// type in; change it here (and rebuild) if the production domain ever
// changes.
//
// Must be the exact host that serves the API with no redirect in
// front of it. The bare apex domain (havnline.com, no "www") 308s to
// www.havnline.com, and React Native's fetch — like a browser — drops
// the Authorization header when a redirect crosses to a different
// host. Every unauthenticated call (pairing) still worked fine
// through that redirect; every call that needs the device's Bearer
// token (saving the printer IP, polling for orders) silently lost it
// and came back "Not paired." Pointing straight at the final host
// avoids the redirect entirely.
export const API_BASE_URL = "https://www.havnline.com";

// How often the tablet checks for new orders. This app runs on a
// tablet that's always plugged in and sitting in the kitchen — not a
// phone anyone's worried about draining — so simple polling beats the
// added complexity of push notifications (Firebase project, background
// wake handling) for very little real-world latency cost. 4 seconds is
// fast enough that an order lands on the printer well within the time
// it takes the AI to finish reading the confirmation back on the call.
export const POLL_INTERVAL_MS = 4000;

// How often the Today's Orders screen refreshes itself in the
// background. This is a read-only status view a staff member glances
// at, not the actual print pipeline (that's POLL_INTERVAL_MS above),
// so it doesn't need print-pipeline latency — 15s keeps it feeling
// live without hammering the API every time the screen is left open
// all day. Pull-to-refresh covers "I need this right now."
export const ORDERS_REFRESH_INTERVAL_MS = 15000;

// Standard raw-ESC/POS-over-TCP port almost every network-connected
// receipt/kitchen printer (Epson, Star Micronics, and most generic
// ESC/POS printers) listens on. Not user-configurable — if a printer
// needs something else, that's unusual enough to handle by hand later
// rather than adding a setup field nobody else will ever need.
export const PRINTER_PORT = 9100;

// How often the QR-charge screen polls for payment (Phase 4 of the
// tablet redesign — Add Item). Much faster than
// ORDERS_REFRESH_INTERVAL_MS above on purpose: a customer is standing
// there watching this exact screen waiting to see it update, not
// glancing at it occasionally like the orders list.
export const ADDENDUM_POLL_INTERVAL_MS = 3000;
