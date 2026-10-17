// Builds public/Phasis_2026_Season.xlsx from the seed. Run with: npm run build:sample
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fullDemoState } from "../lib/seed";
import { buildSampleWorkbook } from "../lib/import/sampleWorkbook";

async function main() {
  const wb = await buildSampleWorkbook(fullDemoState());
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const out = path.resolve("public", "Phasis_2026_Season.xlsx");
  writeFileSync(out, Buffer.from(buf));
  console.log(`Wrote ${out} (${buf.byteLength} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
