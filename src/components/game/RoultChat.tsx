"use client";

/**
 * RoultChat — the SECRET local AI popup. No button anywhere opens this;
 * the only entrance is the keyboard shortcut handled in GameShell.
 *
 * roul is a fully local gamemode designer for ENGINE C:
 *   - a neural intent classifier TRAINED FROM SCRATCH (roult-model.json,
 *     see scripts/roult-train.py) reads the prompt, no API, no network
 *   - it reasons visibly (thinking trace), proposes a PLAN
 *   - the player can REVISI (mutate aspects) or LANJUT (deep think)
 *   - then it synthesizes ENGINE C code from scratch and validates it
 *     with the REAL compiler (compileScript -> WebAssembly)
 *   - keeps a 4096-token context window with a live meter
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildScript,
  chatTokens,
  estTokens,
  makePlan,
  MECH_LABEL,
  revisePlan,
  ROULT_CTX_LIMIT,
  traceThinking,
  type RoultPlan,
} from "@/game/roult";

type Kind = "you" | "trace" | "sys" | "plan" | "code" | "status";
type Phase = "idle" | "thinking" | "plan" | "deepthink" | "codegen" | "result";

interface Msg {
  id: number;
  kind: Kind;
  text: string;
  plan?: RoultPlan;
  full?: string;
  ok?: boolean;
  hooks?: string[];
  bytes?: number;
}

const SYS_TOKENS = estTokens(
  "roult is a local gamemode designer for roultemate. it reads a free-form prompt, plans an ENGINE C table, revises on demand, then writes and compiles the script locally.",
);

const REVISE_CHIPS = [
  "lebih brutal",
  "lebih adil",
  "tambah mekanik acak",
  "peluru diacak tiap ronde",
  "tambah regen tiap ronde",
  "ganti tema ruangan",
];

let msgSeq = 0;

export default function RoultChat({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const runId = useRef(0);
  const timers = useRef<number[]>([]);
  const intervals = useRef<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<RoultPlan | null>(null);

  const busy = phase === "thinking" || phase === "deepthink" || phase === "codegen";

  const pushMsg = useCallback((m: Omit<Msg, "id">) => {
    const id = ++msgSeq;
    setMsgs((prev) => {
      const next = [...prev, { ...m, id }];
      // keep the 4k context window honest: trim the oldest turns
      let usage = chatTokens(next.map((x) => x.text || x.full || ""), SYS_TOKENS);
      let drop = 0;
      while (usage > ROULT_CTX_LIMIT && next.length - drop > 4) {
        usage -= estTokens(next[drop].text || next[drop].full || "");
        drop++;
      }
      return drop > 0 ? next.slice(drop) : next;
    });
    return id;
  }, []);

  /* greeting — only once per mount */
  useEffect(() => {
    const id = ++runId.current;
    const t: number[] = [];
    t.push(
      window.setTimeout(() => {
        if (runId.current !== id) return;
        pushMsg({ kind: "sys", text: "…oh. kamu nemu aku." });
      }, 250),
    );
    t.push(
      window.setTimeout(() => {
        if (runId.current !== id) return;
        pushMsg({
          kind: "sys",
          text: "kasih aku ide gamemode — bahasa bebas. aku baca niatnya, susun rencana, lu bisa revisi atau langsung lanjut. terus aku tulis script ENGINE C-nya dari nol dan compile beneran jadi WASM di browser ini.",
        });
      }, 950),
    );
    timers.current.push(...t);
    return () => {
      runId.current++;
      timers.current.forEach(clearTimeout);
      intervals.current.forEach(clearInterval);
    };
  }, [pushMsg]);

  /* autoscroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const later = useCallback((fn: () => void, ms: number) => {
    const run = runId.current;
    const id = window.setTimeout(() => {
      if (runId.current !== run) return;
      fn();
    }, ms);
    timers.current.push(id);
  }, []);

  /* -------- stage 1+2: understand + plan -------- */
  const send = useCallback(
    (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;
      const run = ++runId.current;
      const seed = (Date.now() ^ (run * 2654435761)) >>> 0;
      pushMsg({ kind: "you", text: prompt });
      setInput("");
      setReviseOpen(false);
      setPhase("thinking");
      const plan = makePlan(prompt, seed);
      planRef.current = plan;
      let t = 300;
      for (const ln of traceThinking(prompt, plan, false)) {
        t += 520 + Math.min(420, ln.length * 7);
        later(() => pushMsg({ kind: "trace", text: ln }), t);
      }
      later(() => {
        pushMsg({ kind: "plan", text: "", plan });
        setPhase("plan");
      }, t + 350);
    },
    [busy, later, pushMsg],
  );

  /* -------- revision: mutate the current plan -------- */
  const submitRevise = useCallback(
    (raw: string) => {
      const plan = planRef.current;
      const text = raw.trim();
      if (!plan || !text || busy) return;
      const run = ++runId.current;
      const seed = (Date.now() ^ (run * 40503)) >>> 0;
      pushMsg({ kind: "you", text: text });
      setInput("");
      setReviseOpen(false);
      setPhase("thinking");
      const { plan: next, applied } = revisePlan(plan, text, seed);
      planRef.current = next;
      let t = 300;
      for (const ln of ["nunggu, aku racik ulang…", ...applied.map((a) => `revisi: ${a}`)]) {
        t += 480;
        later(() => pushMsg({ kind: "trace", text: ln }), t);
      }
      later(() => {
        pushMsg({ kind: "plan", text: "", plan: next });
        setPhase("plan");
      }, t + 350);
    },
    [busy, later, pushMsg],
  );

  /* -------- stage 3: deep think + generate from scratch -------- */
  const cont = useCallback(() => {
    const plan = planRef.current;
    if (!plan) return;
    const run = ++runId.current;
    const seed = (Date.now() ^ 0x9e3779b9) >>> 0;
    setPhase("deepthink");
    let t = 300;
    for (const ln of traceThinking(plan.idea, plan, true)) {
      t += 680 + Math.min(560, ln.length * 8);
      later(() => pushMsg({ kind: "trace", text: ln }), t);
    }
    later(() => {
      const res = buildScript(plan, seed); // real ENGINE C validation
      const id = pushMsg({ kind: "code", text: "", full: res.code });
      setPhase("codegen");
      let pos = 0;
      const iv = window.setInterval(() => {
        if (runId.current !== run) {
          window.clearInterval(iv);
          return;
        }
        pos = Math.min(res.code.length, pos + 5 + Math.floor(Math.random() * 5));
        setMsgs((ms) => ms.map((m) => (m.id === id ? { ...m, text: res.code.slice(0, pos) } : m)));
        if (pos >= res.code.length) {
          window.clearInterval(iv);
          pushMsg({
            kind: "status",
            text: res.ok
              ? `compiled OK — ${res.size} bytes of WASM · hooks: ${res.hooks.join(", ")}`
              : `compiler gagal: ${res.errors.slice(0, 3).join(" · ")}`,
            ok: res.ok,
            hooks: res.hooks,
            bytes: res.size,
          });
          setPhase("result");
        }
      }, 26);
      intervals.current.push(iv);
    }, t + 550);
  }, [later, pushMsg]);

  const ctxUsed = useMemo(
    () => chatTokens(msgs.map((m) => m.text || m.full || ""), SYS_TOKENS),
    [msgs],
  );
  const ctxPct = Math.min(100, Math.round((ctxUsed / ROULT_CTX_LIMIT) * 100));

  const codeMsg = [...msgs].reverse().find((m) => m.kind === "code");

  const copyCode = () => {
    if (!codeMsg?.full) return;
    void navigator.clipboard?.writeText(codeMsg.full).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  const applyCode = () => {
    if (!codeMsg?.full) return;
    window.dispatchEvent(new CustomEvent("roult:apply", { detail: codeMsg.full }));
  };

  return (
    <div
      className="absolute inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pop-in flex h-[min(88vh,720px)] w-[min(94vw,660px)] flex-col overflow-hidden rounded-lg border border-[#8f6ad4]/40 shadow-[0_0_60px_rgba(91,63,168,0.35)]"
        style={{ background: "#0d0b14" }}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-[#8f6ad4]/25 px-4 py-2.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#7b4fd4] shadow-[0_0_8px_#7b4fd4]" />
          <span className="font-mono text-lg tracking-widest text-[#c9b3ec]">
            roult<span className="caret-blink text-[#8f6ad4]">_</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#6d5a96]">
            local gamemode engine
          </span>
          <span className="ml-auto font-mono text-[10px] text-[#6d5a96]">
            trained-from-scratch classifier · no api
          </span>
          <button
            className="rounded border border-[#8f6ad4]/40 px-2 py-0.5 font-mono text-xs text-[#c9b3ec] hover:bg-[#8f6ad4]/20"
            onClick={() => {
              runId.current++;
              timers.current.forEach(clearTimeout);
              intervals.current.forEach(clearInterval);
              timers.current = [];
              intervals.current = [];
              setMsgs([]);
              setPhase("idle");
              setReviseOpen(false);
              const id = ++runId.current;
              window.setTimeout(() => {
                if (runId.current !== id) return;
                pushMsg({ kind: "sys", text: "session baru. kasih ide gamemode." });
              }, 200);
            }}
            title="new session"
          >
            ↺
          </button>
          <button
            className="rounded border border-[#8f6ad4]/40 px-2 py-0.5 font-mono text-xs text-[#c9b3ec] hover:bg-[#8f6ad4]/20"
            onClick={onClose}
            title="close"
          >
            X
          </button>
        </div>

        {/* body */}
        <div ref={scrollRef} className="roult-scroll flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-2">
            {msgs.map((m) => {
              if (m.kind === "you") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded border border-[#8f6ad4]/30 bg-[#8f6ad4]/15 px-3 py-1.5 font-mono text-[13px] leading-snug text-[#e4dbff]">
                      {m.text}
                    </div>
                  </div>
                );
              }
              if (m.kind === "trace") {
                return (
                  <div key={m.id} className="flex items-start gap-2 font-mono text-[12px] leading-snug text-[#9d8cc7]">
                    <span className="text-[#5e4a8f]">▍</span>
                    <span>{m.text}</span>
                  </div>
                );
              }
              if (m.kind === "sys") {
                return (
                  <div key={m.id} className="max-w-[92%] whitespace-pre-wrap rounded border border-[#8f6ad4]/20 bg-[#171226] px-3 py-2 font-mono text-[13px] leading-snug text-[#c9b3ec]">
                    {m.text}
                  </div>
                );
              }
              if (m.kind === "plan" && m.plan) {
                const p = m.plan;
                return (
                  <div key={m.id} className="max-w-[95%] rounded border border-[#8f6ad4]/45 bg-[#14101f] px-3.5 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-mono text-[15px] font-bold tracking-wide text-[#d9c9ff]">{p.title}</div>
                      <div className="font-mono text-[10px] text-[#6d5a96]">
                        sev {p.severity}/2 · v{p.variant}
                      </div>
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] italic text-[#9d8cc7]">{p.tagline}</div>
                    <div className="mt-2 flex flex-col gap-1">
                      {p.mechs.map((mech, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[12px] text-[#c9b3ec]">
                          <span className="text-[#7b4fd4]">◆</span>
                          <span>{MECH_LABEL[mech.id]}</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 font-mono text-[12px] text-[#8f7ab0]">
                        <span className="text-[#5e4a8f]">◇</span>
                        <span>
                          tema ruangan {p.themeName} · lampu #{p.themeColor.toString(16).padStart(6, "0")}
                        </span>
                      </div>
                    </div>
                    {phase === "plan" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          className="rounded border border-[#d9a441]/60 px-3 py-1 font-mono text-xs tracking-wider text-[#d9a441] hover:bg-[#d9a441]/15"
                          onClick={() => setReviseOpen((v) => !v)}
                        >
                          REVISI
                        </button>
                        <button
                          className="rounded border border-[#7b4fd4]/70 bg-[#7b4fd4]/20 px-3 py-1 font-mono text-xs tracking-wider text-[#d9c9ff] hover:bg-[#7b4fd4]/35"
                          onClick={cont}
                        >
                          LANJUT →
                        </button>
                      </div>
                    )}
                    {phase === "plan" && reviseOpen && (
                      <div className="mt-2 border-t border-[#8f6ad4]/25 pt-2">
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {REVISE_CHIPS.map((c) => (
                            <button
                              key={c}
                              className="rounded-full border border-[#8f6ad4]/40 px-2 py-0.5 font-mono text-[11px] text-[#b8a6e0] hover:bg-[#8f6ad4]/20"
                              onClick={() => submitRevise(c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                        <form
                          className="flex gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitRevise(input);
                          }}
                        >
                          <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="tulisan revisi lu… (aspek apa yang diubah?)"
                            className="flex-1 rounded border border-[#8f6ad4]/40 bg-[#0d0b14] px-2 py-1 font-mono text-[12px] text-[#e4dbff] outline-none placeholder:text-[#5e4a8f] focus:border-[#8f6ad4]"
                          />
                          <button className="rounded border border-[#d9a441]/60 px-2.5 py-1 font-mono text-xs text-[#d9a441] hover:bg-[#d9a441]/15">
                            ok
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              }
              if (m.kind === "code") {
                return (
                  <div key={m.id} className="max-w-[95%] overflow-hidden rounded border border-[#8f6ad4]/35 bg-[#0a0812]">
                    <div className="border-b border-[#8f6ad4]/25 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-[#6d5a96]">
                      roultematescript — generated from scratch
                    </div>
                    <pre className="roult-code max-h-72 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-snug text-[#b8e0c0]">
                      {m.text}
                      {phase === "codegen" && m.text.length < (m.full?.length ?? 0) && (
                        <span className="caret-blink">▌</span>
                      )}
                    </pre>
                  </div>
                );
              }
              // status
              return (
                <div key={m.id} className="max-w-[95%]">
                  <div
                    className={`rounded border px-3 py-1.5 font-mono text-[12px] ${
                      m.ok
                        ? "border-[#3f6b3d]/60 bg-[#3f6b3d]/10 text-[#8fd49a]"
                        : "border-[#c73e2e]/60 bg-[#c73e2e]/10 text-[#ff9a8a]"
                    }`}
                  >
                    {m.text}
                  </div>
                  {m.ok && phase === "result" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="rounded border border-[#8f6ad4]/50 px-3 py-1 font-mono text-xs text-[#c9b3ec] hover:bg-[#8f6ad4]/20"
                        onClick={copyCode}
                      >
                        {copied ? "copied ✓" : "COPY"}
                      </button>
                      <button
                        className="rounded border border-[#d9a441]/70 bg-[#d9a441]/15 px-3 py-1 font-mono text-xs text-[#d9a441] hover:bg-[#d9a441]/30"
                        onClick={applyCode}
                      >
                        KIRIM KE CUSTOM TABLE →
                      </button>
                      <span className="self-center font-mono text-[10px] text-[#6d5a96]">
                        niat lu, plan lu, kodeku. jangan lupa coba sebelum dipasang di meja uang beneran.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {busy && (
              <div className="flex items-center gap-2 font-mono text-[12px] text-[#6d5a96]">
                <span className="caret-blink text-[#7b4fd4]">▌</span>
                <span>{phase === "codegen" ? "writing…" : "thinking…"}</span>
              </div>
            )}
          </div>
        </div>

        {/* footer: context meter + input */}
        <div className="border-t border-[#8f6ad4]/25 px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#6d5a96]">ctx</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1c1530]">
              <div
                className={`h-full rounded-full transition-all ${ctxPct > 85 ? "bg-[#c73e2e]" : "bg-[#7b4fd4]"}`}
                style={{ width: `${Math.max(3, ctxPct)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-[#6d5a96]">
              {ctxUsed.toLocaleString()} / {ROULT_CTX_LIMIT.toLocaleString()}
            </span>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (phase === "plan" && reviseOpen) submitRevise(input);
              else send(input);
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder={
                busy
                  ? "roult mikir…"
                  : phase === "plan" && reviseOpen
                    ? "aspek apa yang direvisi?"
                    : "deskripsiin gamemode yang lu mau…"
              }
              className="flex-1 rounded border border-[#8f6ad4]/40 bg-[#171226] px-3 py-2 font-mono text-[13px] text-[#e4dbff] outline-none placeholder:text-[#5e4a8f] focus:border-[#a88fe0] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded border border-[#7b4fd4]/70 bg-[#7b4fd4]/25 px-4 py-2 font-mono text-xs tracking-widest text-[#d9c9ff] hover:bg-[#7b4fd4]/40 disabled:opacity-40"
            >
              SEND
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
