# AeroPlanner, Phasis Air Cargo demo

Frontend-only demo for a Georgian cargo airline pitch: a messy Excel schedule becomes a validated schedule,
a cleared conflict list and a flight packet. Fictional operator (Phasis Air Cargo, ICAO PHC, base UGTB/TBS),
fictional data, no backend, no auth. Spec: `docs/PRD.pdf`. Design board: `design/`.

Stack: Next.js (App Router, static export), TypeScript, Tailwind, shadcn/ui, Zustand, date-fns (all UTC),
exceljs, docx, pdfmake. Heavy libraries load on first use.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Vitest: rules T-R1..T-R7, parser P1..P12, seed totals, exports
npm run typecheck && npm run lint
npm run build      # static export to ./out
npm run build:sample   # rebuilds public/Phasis_2026_Season.xlsx from the seed
```

## Demo clock and state

- The demo clock is fixed at Sun 13 Sep 2026, 14:00Z. No real clock or randomness in application logic (lint rule).
- State lives in `sessionStorage` (key `aeroplanner.demo.v1`): a reload keeps edits, a new tab starts from the full demo.
- Entry points: `?reset=1` full demo, `?start=empty` empty schedule, `?presenter=1` list-state switcher,
  `?legs=1000` stress mode for performance tests.

## Storylines

- A: Reset to empty schedule, Import from Excel, use the sample, accept 9 fixes, fix 5 rows in the drawer, import 90 legs.
- B: Reset to full demo, Conflicts: fix R1, R2 and the R3 AOG issue, 9 open issues become 6.
- C: Checklist export: tick the PHC611 legs and PHC612 XIY to URC, Export PDF.

## Layout

- `lib/` pure logic with tests: `validate.ts` (R1 to R6), `import/` (grammar and sheet reader), `checklist/` (layout model and exporters), `seed/`.
- `components/` screens, `app/` routes (client components only).
