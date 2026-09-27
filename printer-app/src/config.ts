// The HavnLine web app's own URL — same backend the dashboard and the
// AI receptionist already talk to. One company, one backend, so this
// is a build-time constant rather than something the restaurant has to
// type in; change it here (and rebuild) if the production domain ever
// changes, e.g. once havnline.com is live instead of the Vercel URL.
export const API_BASE_URL = "https://havnline.com";

// How often the tablet checks for new orders. This app runs on a
// tablet that's always plugged in and sitting in the kitchen — not a
// phone anyone's worried about draining — so simple polling beats the
// added complexity of push notifications (Firebase project, background
// wake handling) for very little real-world latency cost. 4 seconds is
// fast enough that an order lands on the printer well within the time
// it takes the AI to finish reading the confirmation back on the call.
export const POLL_INTERVAL_MS = 4000;

// Standard raw-ESC/POS-over-TCP port almost every network-connected
// receipt/kitchen printer (Epson, Star Micronics, and most generic
// ESC/POS printers) listens on. Not user-configurable — if a printer
// needs something else, that's unusual enough to handle by hand later
// rather than adding a setup field nobody else will ever need.
export const PRINTER_PORT = 9100;
