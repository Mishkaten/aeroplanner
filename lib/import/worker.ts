/// <reference lib="webworker" />
import { parseWorkbook } from "./pipeline";
import type { ParseCtx } from "./types";

interface Request {
  buffer: ArrayBuffer;
  fileName: string;
  ctx: ParseCtx;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { buffer, fileName, ctx } = e.data;
  try {
    const result = await parseWorkbook(buffer, fileName, ctx, (p) => self.postMessage({ type: "progress", ...p }));
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : "The workbook could not be read." });
  }
};
