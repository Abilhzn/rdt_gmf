// Shared by every feature that downloads a file via HttpClient (a plain <a href> can't carry the
// identity-bridge header, so every download goes through HttpClient + a Blob instead) — Repost's
// original-file download (Batch 6b/6c) and Export's Format TAB download (Batch 6e) both need this,
// consolidated here per Batch 6e's prompt rather than staying duplicated per-feature.
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The export endpoints return EITHER a .xlsx (<=300 rows) OR a .zip of chunk-N.xlsx files (>300
// rows) — the server puts the right extension in Content-Disposition, read it from there instead
// of guessing client-side. `fallback` covers only the pathological case of a response with no
// header at all.
export function filenameFromResponse(headers: { get(name: string): string | null }, fallback: string): string {
  const disposition = headers.get('Content-Disposition') || headers.get('content-disposition');
  const match = disposition ? /filename="?([^";]+)"?/.exec(disposition) : null;
  return match ? match[1] : fallback;
}
