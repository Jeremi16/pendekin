import { apiGet } from "./api";
import type { DashLink } from "./ui";

const PAGE = 50; // server max page size

// Neutralizes spreadsheet formula injection (=, +, -, @, tab, CR) then applies RFC 4180 quoting.
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (s && "=+-@\t\r".includes(s[0])) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(links: DashLink[]): string {
  const header = ["short_url", "original_url", "title", "clicks", "active", "password_protected", "max_clicks", "tags", "expires_at", "last_clicked_at", "created_at"];
  const rows = links.map((l) =>
    [l.short, l.original, l.title ?? "", l.clickCount, l.isActive, l.hasPassword, l.maxClicks ?? "", l.tags.join("; "), l.expiresAt ?? "", l.lastClickedAt ?? "", l.createdAt].map(csvCell).join(",")
  );
  // BOM so Excel detects UTF-8 (titles may contain non-ASCII).
  return "﻿" + [header.join(","), ...rows].join("\r\n") + "\r\n";
}

// Fetches every owned link page by page; onProgress reports (loaded, total).
export async function fetchAllLinks(onProgress?: (loaded: number, total: number) => void): Promise<DashLink[]> {
  const all: DashLink[] = [];
  for (let page = 1; ; page++) {
    const d = await apiGet<{ links: DashLink[]; total: number }>("/dashboard/links", { page, limit: PAGE, sort: "created" });
    all.push(...d.links);
    onProgress?.(all.length, d.total);
    if (d.links.length < PAGE || all.length >= d.total) return all;
  }
}

export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
