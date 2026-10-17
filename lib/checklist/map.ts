import type { ChecklistModel } from "./model";

/**
 * Schematic route map: straight lines between stations, no map tiles and no network request.
 * One drawing routine feeds the preview and the PDF and Word files.
 */
export function drawRouteMap(ctx: CanvasRenderingContext2D, route: ChecklistModel["route"], w: number, h: number): void {
  ctx.fillStyle = "#EEF3F9";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#C9CFC6";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const pos = new Map(route.points.map((p) => [p.iata, { x: p.x * w, y: p.y * h }]));
  ctx.font = "600 13px sans-serif";
  ctx.textBaseline = "middle";

  // One line per leg. Opposite directions between the same pair are offset so both stay visible.
  route.segments.forEach((s) => {
    const a = pos.get(s.from);
    const b = pos.get(s.to);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const side = s.from < s.to ? 1 : -1;
    const ox = (-dy / len) * 6 * side;
    const oy = (dx / len) * 6 * side;
    const [x1, y1, x2, y2] = [a.x + ox, a.y + oy, b.x + ox, b.y + oy];
    ctx.strokeStyle = "#1F5FD0";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    // arrow head near the destination
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ax = x2 - Math.cos(ang) * 14;
    const ay = y2 - Math.sin(ang) * 14;
    ctx.fillStyle = "#1F5FD0";
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * 8, ay + Math.sin(ang) * 8);
    ctx.lineTo(ax + Math.cos(ang + 2.5) * 6, ay + Math.sin(ang + 2.5) * 6);
    ctx.lineTo(ax + Math.cos(ang - 2.5) * 6, ay + Math.sin(ang - 2.5) * 6);
    ctx.closePath();
    ctx.fill();
    // leg number at the midpoint
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(mx, my, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1F5FD0";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#14202E";
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(s.n), mx, my + 0.5);
    ctx.font = "600 13px sans-serif";
  });

  for (const p of route.points) {
    const { x, y } = pos.get(p.iata)!;
    ctx.fillStyle = "#1F5FD0";
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#14202E";
    ctx.textAlign = x > w * 0.85 ? "right" : "left";
    ctx.fillText(p.iata, x + (x > w * 0.85 ? -10 : 10), y - 12);
  }
  ctx.textAlign = "right";
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#46525F";
  ctx.fillText(route.note, w - 8, h - 10);
}

/** PNG data URL of the map at 2x resolution. Browser only. */
export function routeMapPng(route: ChecklistModel["route"], width = 520, height = 170): string | null {
  if (typeof document === "undefined" || route.points.length === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(2, 2);
  drawRouteMap(ctx, route, width, height);
  return canvas.toDataURL("image/png");
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
