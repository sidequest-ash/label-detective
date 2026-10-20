"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats(): Promise<string[]>;
};

export default function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controls: { stop(): void } | undefined;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    let done = false;

    const found = (text: string) => {
      if (done || !/^\d{8,14}$/.test(text)) return;
      done = true;
      navigator.vibrate?.(40);
      cb.current(text);
    };

    (async () => {
      try {
        // Default getUserMedia is ~640x480 with fixed focus: too blurry for EAN bars.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        // focusMode isn't in the TS DOM types yet; unsupported browsers just reject.
        track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        const v = video.current!;
        v.srcObject = stream;
        await v.play();

        // Native detector (Android Chrome) is far better than JS decoding; ZXing covers the rest (iOS).
        const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e"];
        if (BD && (await BD.getSupportedFormats()).includes("ean_13")) {
          const detector = new BD({ formats });
          let busy = false;
          timer = setInterval(async () => {
            if (busy || done || v.readyState < 2) return;
            busy = true;
            const [hit] = await detector.detect(v).catch(() => []);
            busy = false;
            if (hit) found(hit.rawValue);
          }, 120);
        } else {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import("@zxing/browser"),
            import("@zxing/library"),
          ]);
          const hints = new Map<number, unknown>([
            [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
            [DecodeHintType.TRY_HARDER, true],
          ]);
          controls = await new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 }).decodeFromStream(
            stream,
            v,
            (result) => result && found(result.getText()),
          );
        }
        if (cancelled) controls?.stop();
      } catch {
        setError(window.isSecureContext ? "Camera unavailable or permission denied." : "The camera needs HTTPS (or localhost).");
      }
    })();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-label="Barcode scanner"
    >
      <video ref={video} className="absolute inset-0 h-full w-full object-cover opacity-80" muted playsInline />
      <div className="relative flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">Scanning</span>
        <button onClick={onClose} className="rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur">
          Close
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <motion.div
          className="relative aspect-[1.6] w-[78%] max-w-md"
          initial={{ scale: 1.15, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
        >
          {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((c) => (
            <span key={c} className={`absolute h-8 w-8 rounded-[4px] border-white ${c}`} />
          ))}
          <motion.span
            className="absolute inset-x-3 h-px bg-white shadow-[0_0_18px_4px_rgba(255,255,255,0.55)]"
            animate={{ top: ["8%", "92%", "8%"] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </div>
      <p className="relative px-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-white/70">
        {error ?? "Line the barcode up inside the frame."}
      </p>
    </motion.div>
  );
}
