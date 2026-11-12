# Bin Day for Homebridge

Never miss bin day. This plugin reads your council's bin collection dates and shows a
sensor in the Home app for each bin. Each sensor turns on the evening before collection,
so a Hue light can glow in that bin's colour. You can also ask Siri when the next
collection is.

Supported councils: **Wokingham Borough Council**.

![How Bin Day works](docs/how-it-works.svg)

## What you get

- **A sensor per bin** in the Home app, such as Recycling, Household waste and Food waste.
- **On the evening before** collection, and off again on collection day.
- **Works if the council site is down.** Dates are saved on the Pi.
- **A Siri link** that answers "when are the bins?" out loud.
- **A web API and calendar feed** for other apps.

![When does a sensor turn on?](docs/timeline.svg)

## Install

The plugin installs straight from GitHub. In the Homebridge web page, open
**Terminal** (top-right menu) and run:

```
cd /var/lib/homebridge
npm install github:phevenAm/homebridge-bin-day
```

It can take a few minutes on a Raspberry Pi. When it's done, add the settings below
and restart Homebridge.

To update later, run the same two lines again and restart.

## Settings

Open **JSON Config** (top-right menu) and add this inside the `platforms` list:

```json
{
    "platform": "BinDay",
    "name": "Bin Day",
    "council": "wokingham",
    "postcode": "RG40 2HR",
    "houseNumber": "90",
    "alertTime": "18:00",
    "endTime": "12:00",
    "binColours": [
        { "bin": "Recycling", "colour": "green" },
        { "bin": "Household waste", "colour": "black" }
    ]
}
```

Watch the commas between items in the list.

| Setting | What it does | Default |
| --- | --- | --- |
| `postcode` | Your postcode, with the space. | (required) |
| `houseNumber` | Your house number or name, as the council writes it. | (required) |
| `council` | Which council to read. | `wokingham` |
| `alertTime` | When sensors turn on, the evening before (24-hour). | `18:00` |
| `endTime` | When sensors turn off, on collection day (24-hour). | `12:00` |
| `refreshHours` | How often to check the council site. | `12` |
| `httpPort` | Port for the web API. Set to `0` to turn it off. | `8586` |
| `apiKey` | Optional key that apps must send. See below. | (none) |
| `binColours` | Optional colour per bin, shown in the API. | (none) |

After a restart, the log should show:

```
[Bin Day] Bin Day v0.3.0 starting
[Bin Day] Web API ready on port 8586. Try http://<your-pi>:8586/api
[Bin Day] Bin days for 90, Some Road, Wokingham:
[Bin Day]   Recycling: 2026-11-17
[Bin Day]   Household waste: 2026-11-24
```

## Light up a Hue lamp

Do this once for each bin:

1. Open the **Home** app and go to **Automation**.
2. Tap **+**, then **A Sensor Detects Something**.
3. Pick a bin sensor, such as **Recycling**.
4. Pick your Hue light, then press and hold it to set the colour.
5. Optional: set it to turn off after a while.

## Web API

The plugin runs a small read-only web API on your home network, so Siri, calendars,
widgets and your own apps can use your bin days. `admin` is the Pi's name. If `.local`
doesn't work, use the Pi's IP address instead.

| Link | What you get |
| --- | --- |
| `http://admin.local:8586/api` | A list of all the links below. |
| `http://admin.local:8586/api/bins` | All upcoming bins, as JSON. |
| `http://admin.local:8586/api/bins/next` | The next collection day, as JSON. |
| `http://admin.local:8586/api/bins/next.txt` | The next collection as a sentence, for Siri. |
| `http://admin.local:8586/api/bins/recycling` | One bin, as JSON. Use the bin's `id`. |
| `http://admin.local:8586/api/bins.ics` | A calendar feed. |
| `http://admin.local:8586/api/status` | Is it working? Last check, last error, version. |

Each bin in the JSON looks like this:

```json
{
  "id": "recycling",
  "type": "Recycling",
  "date": "2026-11-17",
  "dayName": "Tuesday",
  "daysAway": 1,
  "outTonight": true,
  "colour": "green"
}
```

- `outTonight` is `true` while the Home app sensor is on.
- `colour` only appears if you set it in `binColours`.

The old links `/next` and `/bins` still work.

### Access key (optional)

On a home network you don't need one. If you set `apiKey`, every request must include it,
in any of these ways:

- Add `?key=YOUR_KEY` to the link.
- Send a header: `X-API-Key: YOUR_KEY`.
- Send a header: `Authorization: Bearer YOUR_KEY`.

### Ask Siri

1. Open **Shortcuts** and make a new shortcut called **Bin day**.
2. Add **Get Contents of URL** with `http://admin.local:8586/api/bins/next.txt`.
3. Add **Show Result**.
4. Say "Hey Siri, bin day".

### Bin days in your calendar

On your iPhone: **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other →
Add Subscribed Calendar**, and enter `http://admin.local:8586/api/bins.ics`.
Each collection shows as an all-day event, with a reminder at your `alertTime` the day before.

Because the link is on your home network, the calendar only updates when your phone is
on your home Wi-Fi. Google Calendar can't reach it, as Google fetches calendars from
its own servers.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| No `[Bin Day]` lines in the log | The settings are missing. Check the JSON Config entry and its commas, then restart. |
| `Permission denied (publickey)` when installing | The GitHub repo is private or the name is wrong. It must be public. |
| `Please add your postcode and house number` | A setting name is misspelt. Copy the example above. |
| `Couldn't read the council site` | The site is down or has changed. Saved dates are still used. If it keeps happening, the reader may need updating. |
| `Could not find "…" in the addresses` | Use your house number exactly as the council website lists it. |
| No sensors in the Home app | Sensors appear after the first good read. Check the log for your bin dates. |
| Not sure if it's working | Open `http://admin.local:8586/api/status`. `ok: true` means the last check worked. |
| `401` from the API | You've set an `apiKey`. Add `?key=YOUR_KEY` to the link. |

## How it's built

```
src/
  index.ts             Registers the plugin with Homebridge
  platform.ts          Makes the sensors and turns them on and off
  schedule.ts          Works out when a sensor should be on
  http.ts              The web API (JSON, Siri text, calendar)
  councils/
    index.ts           List of supported councils
    wokingham.ts       Reads the Wokingham website
    session.ts         Keeps cookies between page loads
docs/                  Diagrams for this README
```

To add another council, write a reader in `src/councils/` that returns each bin's name
and next date, then add it to `src/councils/index.ts`.

## Credit

The Wokingham reader is based on [UKBinCollectionData](https://github.com/robbrad/UKBinCollectionData) (MIT).
