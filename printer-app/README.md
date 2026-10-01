# HavnLine Printer

The tablet app that pairs with a restaurant's HavnLine account and prints
phone orders straight to their kitchen printer — the universal fallback
for a business with no SpotOn connection. See the backend side of this
in the main repo: `lib/integrations/printer-app.ts` and
`app/api/printer-app/*`.

## How it works

1. The owner clicks **Get pairing code** on their HavnLine dashboard
   (Integrations → Kitchen printer app).
2. They open this app on any Android tablet and type in that code.
3. The tablet enters the kitchen printer's local IP address once.
4. From then on, the app polls HavnLine every few seconds for new
   orders and prints each one on that printer over the local network
   (raw ESC/POS on port 9100 — the same protocol most network-connected
   receipt printers already speak).

No push notifications, no cloud printing service, no printer-specific
SDK — this is a plugged-in kitchen tablet, not a phone worried about
battery, so simple polling is the right trade-off (see `src/config.ts`).

## Project layout

```
App.tsx                 Root — decides Pairing vs the paired tab shell (Orders / Setup)
src/config.ts           API base URL, poll interval, printer port, orders/addendum refresh intervals
src/lib/storage.ts       Persists device_token / printer IP across restarts
src/lib/api.ts           Thin client for /api/printer-app/*
src/lib/printer.ts       Raw ESC/POS-over-TCP printing
src/lib/poller.ts        Poll loop: fetch pending print jobs -> print -> ack
src/screens/PairingScreen.tsx   First-run pairing code entry
src/screens/HomeScreen.tsx      "Setup" tab: printer IP, test print, activity log, unpair
src/screens/OrdersScreen.tsx    "Orders" tab (default view): today's orders list + detail,
                                 with PIN-gated Refund/Discount and "Add item" actions in the
                                 detail screen
src/components/MoneyActionModal.tsx   PIN entry -> amount/reason -> submit, used by OrdersScreen
src/components/AddItemModal.tsx       Menu item picker -> comp (free) or charge-via-QR, used by
                                       OrdersScreen; the QR is generated server-side, so this app
                                       never needs its own QR-rendering dependency
```

## Running it during development

This app uses `react-native-tcp-socket` for raw socket printing, which
needs real native code — it will **not** run inside the plain Expo Go
app. Use a development build instead:

```bash
npx expo run:android          # requires Android Studio / an Android SDK locally
# or, without installing Android Studio at all:
npx eas build --platform android --profile development
```

## Building a real, installable APK

The easiest path (no local Android Studio needed) is
[EAS Build](https://docs.expo.dev/build/introduction/), Expo's cloud
build service — free tier covers this fine for a single app like this
one:

```bash
npm install -g eas-cli
eas login                      # free Expo account
eas build:configure            # only needed the very first time
eas build --platform android --profile preview
```

That prints a link when the build finishes; download the `.apk` from
there and install it on the tablet directly (no Play Store needed for
internal use — "Install unknown apps" has to be allowed for whichever
app you use to open the file, e.g. Chrome or Files).

### Updating a tablet that's already paired

Every change merged into this repo's `printer-app/` folder (new
screens, new backend calls, bug fixes) only reaches a real tablet the
next time someone runs the `eas build --profile preview` command
above and installs the resulting APK — merging code here never
updates an app already sitting on a tablet.

Re-running that same command is the whole process: no need to unpair
the tablet or uninstall the old app first. `eas.json`'s `preview`
profile has `autoIncrement: true`, so every build gets a fresh,
higher `versionCode`, and Android installs the new APK right over the
old one — the pairing (its `device_token`) and the saved printer IP
both survive, because that's ordinary app data, not something an
in-place update wipes. Only a full uninstall (not an update-install)
would lose that pairing and require re-pairing from the dashboard.

## Before shipping this to a real restaurant

- `src/config.ts` has `API_BASE_URL` hardcoded to
  `https://www.havnline.com` (note the `www` — the bare domain 308
  redirects there, and that redirect drops this app's Authorization
  header, see the comment in that file) — update this if the
  production domain is different at the time you build.
- The printer's IP address can change if the restaurant's router
  reassigns it (common with DHCP). Worth telling restaurants to set a
  static/reserved IP for the printer on their router, or this will
  need re-entering occasionally.
