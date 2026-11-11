# Bin Day for Homebridge

Shows a sensor in the Home app for each of your bins. Each one turns on the evening
before collection and off on collection day. Use Home app automations to make a Hue
light glow in each bin's colour.

Supported councils: Wokingham Borough Council.

## Install (from GitHub, on the Homebridge Terminal)

```
cd /var/lib/homebridge
npm install github:phevenAm/homebridge-bin-day
```

Then restart Homebridge.

## Settings

Add this to the `platforms` list in your Homebridge JSON config:

```json
{
    "platform": "BinDay",
    "name": "Bin Day",
    "council": "wokingham",
    "postcode": "RG40 2HR",
    "houseNumber": "90",
    "alertTime": "18:00",
    "endTime": "12:00"
}
```

- `alertTime`: when the sensor turns on, the evening before. Default 18:00.
- `endTime`: when it turns off on collection day. Default 12:00.
- `refreshHours`: how often to check the council site. Default 12.

Dates are saved, so it keeps working if the council site is down.

## Light up a Hue lamp

In the Home app: Automation → + → "A Sensor Detects Something" → pick a bin
(e.g. Recycling) → pick your Hue light → set its colour. Repeat for each bin.

## Credit

The Wokingham reader is based on UKBinCollectionData (MIT):
https://github.com/robbrad/UKBinCollectionData
