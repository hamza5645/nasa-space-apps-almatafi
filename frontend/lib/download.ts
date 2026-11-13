// File exports (U5): POST /api/export, then hand the browser the file.

import { API_URL, ApiError, type ExportRequest } from "./api.ts";

const EXT: Record<string, string> = { csv: "csv", geojson: "geojson", json: "json", geotiff: "tif" };

export function exportName(r: Pick<ExportRequest, "what" | "format" | "start" | "end">): string {
  return `almatafi_${r.what}_${r.start}_${r.end}.${EXT[r.format]}`;
}

export async function download(body: ExportRequest): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server, so exports aren't available right now.");
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error;
    throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Export failed (${res.status}).`, e?.details ?? {});
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = exportName(body);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
