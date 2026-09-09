import { useCallback, useEffect, useRef } from "react";
import QRCodeStyling from "qr-code-styling";
import { DEFAULT_SETTINGS, QR_DEFAULT_SIZE } from "../lib/constants";
import { applyQrSettings } from "../lib/utils";

export default function useQrCode() {
  const qrRef = useRef<HTMLDivElement>(null);

  const qrCode = useRef<QRCodeStyling | null>(null);
  if (!qrCode.current) {
    qrCode.current = new QRCodeStyling({
      width: QR_DEFAULT_SIZE,
      height: QR_DEFAULT_SIZE,
      type: "svg",
      dotsOptions: { color: DEFAULT_SETTINGS.dotsColor, type: DEFAULT_SETTINGS.dotsType as any },
      backgroundOptions: { color: DEFAULT_SETTINGS.backgroundColor },
      imageOptions: { crossOrigin: "anonymous", margin: 10 },
    });
  }

  const render = useCallback((data: string, settings: typeof DEFAULT_SETTINGS) => {
    if (!qrCode.current) return;
    applyQrSettings(qrCode.current, data, settings);
    if (qrRef.current) {
      qrRef.current.innerHTML = "";
      qrCode.current.append(qrRef.current);
    }
  }, []);

  const download = useCallback((ext: "png" | "svg" | "jpeg" | "webp", data: string) => {
    if (!data) return;
    const name = data.replace(/^https?:\/\//, "").replace(/[^\w-]/g, "-") || `qr-${Date.now()}`;
    qrCode.current?.download({ name, extension: ext as any });
  }, []);

  // re-render on mount if needed
  useEffect(() => {}, []);

  return { qrRef, render, download, instance: qrCode };
}
