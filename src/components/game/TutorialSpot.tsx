"use client";

/**
 * TutorialSpot — the INTERACTIVE tutorial overlay.
 *
 * A golden dashed outline is drawn around the real HUD element the step
 * talks about (a "spotlight" cutout over a dimmed screen). The player
 * follows it like a real tutorial: info steps block the screen until
 * NEXT is pressed, ACTION steps keep the whole game clickable and pulse
 * a "CLICK IT!" chip — the step completes when the real action happens
 * (using a skill, pulling the trigger, ringing the bell...).
 */

import { useCallback, useEffect, useState } from "react";

export interface TutorialSpotProps {
  /** value of the data-tut attribute to spotlight; null = center card */
  target: string | null;
  title: string;
  text: string;
  /** 1-based step number, for the progress chip */
  step: number;
  total: number;
  /** true = a click-eater blocks the screen outside the card */
  blocking: boolean;
  /** true = the target stays clickable and pulses "CLICK IT!" */
  actionMode: boolean;
  nextLabel: string;
  skipLabel: string;
  waitingLabel: string;
  clickLabel: string;
  onNext: () => void;
  onSkip: () => void;
}

const CARD_W = 300;
const PAD = 9;

export default function TutorialSpot({
  target,
  title,
  text,
  step,
  total,
  blocking,
  actionMode,
  nextLabel,
  skipLabel,
  waitingLabel,
  clickLabel,
  onNext,
  onSkip,
}: TutorialSpotProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const remeasure = useCallback(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tut="${target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [target]);

  useEffect(() => {
    remeasure();
    window.addEventListener("resize", remeasure);
    // HUD chips come and go (the shell board fades, hearts appear...),
    // so re-check on a slow interval too
    const iv = setInterval(remeasure, 600);
    return () => {
      window.removeEventListener("resize", remeasure);
      clearInterval(iv);
    };
  }, [remeasure]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  /* card placement: near the spotlight when there is one, center otherwise */
  let cardStyle: React.CSSProperties;
  if (rect) {
    const cx = rect.left + rect.width / 2;
    const left = Math.min(Math.max(cx - CARD_W / 2, 8), Math.max(8, vw - CARD_W - 8));
    const below = rect.bottom + 16;
    const above = rect.top - 16 - 210; // rough card height
    const top = below + 210 < vh - 8 ? below : above > 8 ? above : Math.min(vh - 220, Math.max(8, rect.bottom + 10));
    cardStyle = { left, top, width: CARD_W };
  } else {
    cardStyle = { left: Math.max(8, vw / 2 - CARD_W / 2), top: Math.max(8, vh / 2 - 140), width: CARD_W };
  }

  const holeStyle: React.CSSProperties | null = rect
    ? {
        left: rect.left - PAD,
        top: rect.top - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
        borderRadius: 14,
        outline: "3px dashed rgba(217,164,65,0.95)",
        outlineOffset: 4,
        boxShadow: actionMode
          ? "0 0 0 4px rgba(217,164,65,0.22), 0 0 0 9999px rgba(8,6,4,0.30)"
          : "0 0 0 9999px rgba(8,6,4,0.62)",
      }
    : null;

  const clickChip: React.CSSProperties | null = rect
    ? {
        left: Math.min(Math.max(rect.left + rect.width / 2 - 46, 6), Math.max(6, vw - 100)),
        top: rect.top - 44 < 6 ? rect.bottom + 12 : rect.top - 44,
      }
    : null;

  return (
    /* the wrapper itself never eats clicks — the click-eater (blocking
       info steps) and the card opt back in individually */
    <div className="pointer-events-none absolute inset-0 z-[58]">
      {blocking && <div className="absolute inset-0" style={{ pointerEvents: "auto" }} />}

      {holeStyle && <div className="tut-outline absolute" style={holeStyle} />}

      {actionMode && clickChip && (
        <div className="absolute" style={clickChip}>
          <div className="blink-soft doodle-box doodle-red px-2.5 py-0.5 font-marker text-sm rotate-[-2deg]">
            {clickLabel}
          </div>
        </div>
      )}

      <div className="absolute" style={{ ...cardStyle, pointerEvents: "auto" }}>
        <div className="pop-in doodle-box px-4 py-3 rotate-[-1deg]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-marker text-sm text-[#8f2418]">{title}</span>
              <span className="font-hand-sc text-[11px] text-[#4a4036]">
                {step}/{total}
              </span>
            </div>
            <button
              className="doodle-btn px-2 py-0.5 font-marker text-xs opacity-70"
              title={skipLabel}
              onClick={onSkip}
            >
              X
            </button>
          </div>
          <div className="mt-1 font-hand text-[15px] leading-snug">{text}</div>
          {!actionMode && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="mr-auto font-hand-sc text-[10px] text-[#4a4036] opacity-70">{waitingLabel}</span>
              <button className="doodle-btn doodle-red px-3 py-1 font-hand-sc text-sm" onClick={onNext}>
                {step >= total ? "OK" : nextLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
