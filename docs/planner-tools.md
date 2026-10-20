# Planner tools

Added after the comparison with Leon Sched. All of it works on the version you are editing.

## Bulk edit and aircraft swap (Schedule, "Bulk edit")
Shift time, change block time, flight number, move to one aircraft, swap two aircraft, change airports, cancel or restore, notes. Applies to the legs shown on screen or the ticked ones. The dialog lists what changes and which new issues it would create or clear before anything is saved. One undo.

## Repeat week (Schedule, "Repeat week")
Copies one week onto the following 1 to 52 weeks as ordinary legs. UTC time kept, or local time kept at the departure station (so UTC moves with daylight saving). Days that already have the same leg are skipped, so it is safe to run twice. Permit rows can be copied as pending.

## Patterns (Patterns page)
A pattern is one or more legs that repeat on set weekdays, every 1 to 4 weeks, between two dates, in UTC or in local time at the departure station.
- It generates ordinary dated legs and remembers which ones (`leg.source.patternId`).
- Editing the pattern updates the legs nobody changed, adds new ones and removes the ones it no longer makes. A leg edited or cancelled by hand is never overwritten or removed (it is "kept"); when a pattern no longer makes such a leg it becomes an ordinary leg.
- The dialog previews adds, updates, removals, clashes and new issues before saving.
- Delete: with the untouched legs, or keep every leg as an ordinary leg.
- **Find patterns in the schedule:** legs that already repeat on the same weekday at the same time at least three times, every 1 to 4 weeks, become proposals (legs that follow each other on one aircraft are chained into one rotation). A proposal is kept only if it regenerates exactly the legs it covers. Adopting changes no leg, it only tags them.
- Limits: 3000 legs per pattern or repeat, about two years per pattern.

## Versions (Versions page)
A version is a full copy of the schedule (legs, permits, patterns). One version is live, the others are drafts.
- Everything on screen and every export shows the version you are editing; a banner says when it is a draft. Fleet, airports, permit rules, maintenance blocks and the company profile are shared.
- New version (copy or empty), open, rename, delete (not the live one), compare with live (added, removed, changed legs), publish (the old live version stays as a draft). Up to 12 versions.
- Conflicts are checked inside each version on its own.
- Storage: `legs`, `permits`, `patterns` hold the version being edited; the others are in `parked`. The copy saved to the shared workspace always has the live version in front (`canonicalState`), so two people looking at different versions never change what the other loads.

## Time zones and daylight saving
Airports have an IANA time zone (`tzId`). Local arrival times, "DAY n LT" checks, the Local/UTC switch on the Schedule, export local columns and SSIM offsets all follow it, so they stay right after the clock change on 25 Oct 2026. A weekly SSIM pattern is split where the offset changes. An airport without a zone keeps its fixed offset. Workspaces saved earlier get a zone from the starter directory (by ICAO), or a fixed zone that matches their offset, when they load.

## Not covered
- Leon's own Excel layout and a check of our SSIM against a Leon import (waiting for sample files).
- Live test against the shared Supabase workspace (needs the login): the save path and the "keep looking at my draft after a reload" path are covered by unit tests only.
