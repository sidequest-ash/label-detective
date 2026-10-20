"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { XIcon } from "@phosphor-icons/react";

type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats(): Promise<string[]>;
};

export default function Scanner({ onCode, onClose, onType }: { onCode: (code: string) => void; onClose: () => void; onType: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const still = useReducedMotion();

  // Dialog focus: move in on open, keep Tab inside, hand back on close. The page behind is `inert`.
  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog.current) return;
      const els = [...dialog.current.querySelectorAll<HTMLElement>("button")];
      const [firstEl, lastEl] = [els[0], els[els.length - 1]];
      if (e.shiftKey && document.activeElement === firstEl) (e.preventDefault(), lastEl.focus());
      else if (!e.shiftKey && document.activeElement === lastEl) (e.preventDefault(), firstEl.focus());
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      returnTo.current?.focus();
    };
  }, []);

  const typeInstead = () => {
    returnTo.current = null; // the barcode field focuses itself when it appears
    onType();
  };

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
      className="fixed inset-0 z-50 flex flex-col bg-[#0d0d10] text-[#f1f1f3]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
    >
      <video ref={video} className="absolute inset-0 h-full w-full object-cover opacity-80" muted playsInline />
      <div className="relative flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-white/70">{error ? "Camera unavailable" : "Scanning"}</span>
        <button ref={closeBtn} onClick={onClose} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur active:scale-95">
          <XIcon size={14} weight="bold" aria-hidden /> Close
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <motion.div
          className="relative aspect-[1.6] w-[78%] max-w-md"
          initial={{ scale: 1.15, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 24 }}
        >
          {!error && ["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((c) => (
            <span key={c} className={`absolute h-8 w-8 rounded-[4px] border-white ${c}`} />
          ))}
          {!error && (
            <motion.span
              className="absolute inset-x-3 top-1/2 h-px bg-white shadow-[0_0_18px_4px_rgba(255,255,255,0.55)]"
              animate={still ? undefined : { top: ["8%", "92%", "8%"] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </motion.div>
      </div>
      <div className="relative px-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center" role="status" aria-live="polite">
        <p className={error ? "text-base text-white" : "text-sm text-white/70"}>
          {error ?? "Line the barcode up inside the frame. The camera image stays on your device."}
        </p>
        <button
          onClick={typeInstead}
          className={`mt-4 rounded-full px-6 py-3 text-sm font-medium ${error ? "bg-[#f1f1f3] text-[#0d0d10]" : "bg-white/10 backdrop-blur"}`}
        >
          Type barcode instead
        </button>
      </div>
    </motion.div>
  );
}
