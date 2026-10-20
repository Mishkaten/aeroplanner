# Schedule export formats

Schedule page, **Export** button. Every format is written from the same flat rows (`lib/export/rows.ts`), so they agree with each other.

| Format | File | For | Notes |
|---|---|---|---|
| Excel season grid | .xlsx | Our own layout | Aircraft columns, one row per day, one line per leg, week banners, permit colours. The Excel import reads it back (tested). |
| Excel list | .xlsx | Sorting, filtering, pivots | One row per leg. Real dates and times, UTC and local. |
| CSV | .csv | Any tool | Same columns as the list. UTF-8 with BOM, comma separated, formulas defused. |
| SSIM | .txt | Leon Sched, DCS, PSS | IATA SSIM Chapter 7, UTC mode. Needs the company IATA designator. |
| Calendar | .ics | Outlook, Google, Apple | One event per leg, UTC. |
| PDF | .pdf | Print | A4 landscape list. |
| JSON | .json | Developers | `aeroplanner.schedule.v1`. |

Cancelled legs are left out unless the box is ticked.

## SSIM details

- Record order: type 1 header, four zero records, type 2 carrier, type 3 flight legs, type 5 trailer. Every record is 200 characters, CRLF between records.
- Dated legs are collapsed into recurring patterns (period plus days of week) that expand to exactly the same dates. A gap in a weekly run starts a new record.
- Legs to the placeholder station (XXXX) and flight numbers without digits cannot be written. The dialog lists them after the download.
- Service type: F (scheduled cargo), P for ferry legs.
- Aircraft types are mapped to IATA codes in `iataAircraftType` (B737-800 to 738, B767-300 to 763). Unknown types use their first three letters and digits.
- Field positions come from the open-source `ssimparser` reader, not from the paid IATA manual.

## Not verified yet

- **Leon import of our SSIM file.** Leon says it imports SSIM, but we have not loaded a file into Leon. When a Leon account is available: import a small export, compare with a file Leon exports itself, and fix any field Leon reads differently (PRBD, aircraft configuration, terminals, date variation byte).
- **Leon XLS.** Leon's own Excel import needs its exact export layout, which is not published. Add a "Leon Excel" format once we have a sample file exported from Leon.
