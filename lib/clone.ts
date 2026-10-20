/** structuredClone where available, JSON round trip otherwise. Schedule data is plain JSON, so both give the same result. */
export function structuredCloneSafe<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
