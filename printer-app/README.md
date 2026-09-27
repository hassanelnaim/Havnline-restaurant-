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
App.tsx                 Root — decides Pairing vs Home based on stored pairing state
src/config.ts           API base URL, poll interval, printer port
src/lib/storage.ts       Persists device_token / printer IP across restarts
src/lib/api.ts           Thin client for /api/printer-app/*
src/lib/printer.ts       Raw ESC/POS-over-TCP printing
src/lib/poller.ts        Poll loop: fetch pending orders -> print -> ack
src/screens/PairingScreen.tsx   First-run pairing code entry
src/screens/HomeScreen.tsx      Printer IP setup, test print, activity log, unpair
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
eas build:configure
eas build --platform android --profile preview
```

That prints a link when the build finishes; download the `.apk` from
there and install it on the tablet directly (no Play Store needed for
internal use — "Install unknown apps" has to be allowed for whichever
app you use to open the file, e.g. Chrome or Files).

## Before shipping this to a real restaurant

- `src/config.ts` has `API_BASE_URL` hardcoded to `https://havnline.com`
  — update this if the production domain is different at the time you
  build.
- The printer's IP address can change if the restaurant's router
  reassigns it (common with DHCP). Worth telling restaurants to set a
  static/reserved IP for the printer on their router, or this will
  need re-entering occasionally.
