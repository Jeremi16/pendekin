export function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function applyQrSettings(instance: any, data: string, s: any) {
  instance.update({
    data: data || " ",
    dotsOptions: {
      type: s.dotsType,
      color: s.gradient ? undefined : s.dotsColor,
      gradient: s.gradient
        ? {
            type: "linear",
            colorStops: [
              { offset: 0, color: s.dotsColor },
              { offset: 1, color: s.gradientColor2 },
            ],
          }
        : undefined,
    },
    backgroundOptions: { color: s.backgroundColor },
    cornersSquareOptions: { type: s.cornersType, color: s.dotsColor },
    cornersDotOptions: { type: s.cornersType === "dot" ? "dot" : "square", color: s.dotsColor },
    imageOptions: { imageSize: 0.22, margin: 6 },
  });
  // image
  if (s.logo) instance.update({ image: s.logo });
  else instance.update({ image: undefined });
}

export function formatApiError(err: any, fallback: string) {
  const data = err?.response?.data;
  if (data?.error) {
    const details = data?.details;
    if (Array.isArray(details)) return details.join(" | ");
    return data.error;
  }
  return data?.message || fallback;
}

export function formatReadableDate(v: string | null | undefined) {
  if (!v) return "No expiry";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleString();
}

export function saveRecent(item: { short: string; original: string; createdAt: string }) {
  try {
    const raw = localStorage.getItem("pendekin_recent");
    const arr = raw ? JSON.parse(raw) : [];
    const next = [item, ...arr.filter((x: any) => x.short !== item.short)].slice(0, 10);
    localStorage.setItem("pendekin_recent", JSON.stringify(next));
  } catch {}
}

export function loadRecent(): { short: string; original: string; createdAt: string }[] {
  try {
    const raw = localStorage.getItem("pendekin_recent");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
