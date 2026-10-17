import type { ImportResult, Progress } from "./pipeline";
import type { ParseCtx } from "./types";

/**
 * Parses in a Web Worker (NF-P5) so 1,000 lines never block the interface. If a worker cannot start
 * (for example in a locked-down browser) the same code runs on the main thread.
 */
export async function runImport(buffer: ArrayBuffer, fileName: string, ctx: ParseCtx, onProgress: (p: Progress) => void): Promise<ImportResult> {
  if (typeof Worker !== "undefined") {
    try {
      return await new Promise<ImportResult>((resolve, reject) => {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent) => {
          const m = e.data;
          if (m.type === "progress") onProgress({ pct: m.pct, parsed: m.parsed, stage: m.stage });
          else if (m.type === "done") {
            worker.terminate();
            resolve(m.result as ImportResult);
          } else if (m.type === "error") {
            worker.terminate();
            reject(new Error(m.message));
          }
        };
        worker.onerror = (ev) => {
          worker.terminate();
          reject(new Error(ev.message || "worker failed"));
        };
        worker.postMessage({ buffer: buffer.slice(0), fileName, ctx });
      });
    } catch (e) {
      // A reading error is a real error. Only fall back when the worker itself failed to run.
      const msg = e instanceof Error ? e.message : "";
      if (/No aircraft header|no sheet|zip|corrupt|not a valid|Can't find end/i.test(msg)) throw e;
    }
  }
  const { parseWorkbook } = await import("./pipeline");
  return parseWorkbook(buffer, fileName, ctx, onProgress);
}
