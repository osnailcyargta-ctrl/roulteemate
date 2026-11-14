"use client";

/**
 * RoultChat — the SECRET local AI popup. No button anywhere opens this;
 * the only entrance is the keyboard shortcut handled in GameShell.
 *
 * roul is a fully local gamemode designer powered by a REAL transformer:
 *   - ~55M parameters, TRAINED FROM SCRATCH (scripts/roult2/, weights in
 *     public/models/roult.bin) — no API, no network, runs in this tab
 *   - it streams its reasoning (<think>), proposes a PLAN
 *   - the player can REVISI (mutate aspects) or LANJUT (deep think)
 *   - then it WRITES roulteematescript token-by-token under a grammar
 *     masker, and the result is validated with the REAL compiler
 *     (compileScript -> WebAssembly) before it is shown
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { compileScript } from "@/game/script";
import { openSession, type PlanParsed, type RoultSession } from "@/game/roult/brain";

type Kind = "you" | "trace" | "sys" | "plan" | "code" | "status";
type Phase = "idle" | "loading" | "thinking" | "plan" | "deepthink" | "result";

interface Msg {
  id: number;
  kind: Kind;
  text: string;
  plan?: PlanParsed;
  full?: string;
  ok?: boolean;
  hooks?: string[];
  bytes?: number;
}

const REVISE_CHIPS = [
  "lebih brutal",
  "lebih adil",
  "tambah mekanik acak",
  "peluru diacak tiap ronde",
  "tambah regen tiap ronde",
  "ganti tema ruangan",
];

const MAXT = 384; // the model's context window (tokens)

let msgSeq = 0;

export default function RoultChat({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [ctxTok, setCtxTok] = useState(0);
  const [copied, setCopied] = useState(false);
  const sessionRef = useRef<RoultSession | null>(null);
  const runId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const codeMsgId = useRef<number>(0);
  const codeBuf = useRef<string>("");

  const busy = phase === "loading" || phase === "thinking" || phase === "deepthink";

  const pushMsg = useCallback((m: Omit<Msg, "id">) => {
    const id = ++msgSeq;
    setMsgs((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  const patchMsg = useCallback((id: number, patch: Partial<Msg>) => {
    setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  /* greeting */
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
          text: "aku roult — otakku 55M parameter, ditrain dari nol buat satu hal: nulis gamemode roulteematescript. kasih ide, bahasa bebas. aku baca, mikir, kasih plan — lu bisa revisi atau langsung lanjut.",
        });
      }, 950),
    );
    return () => {
      runId.current++;
      t.forEach(clearTimeout);
    };
  }, [pushMsg]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const ensureSession = useCallback(async () => {
    if (!sessionRef.current) {
      setPhase("loading");
      pushMsg({ kind: "sys", text: "memuat otak… 55M param, sekali saja." });
      sessionRef.current = await openSession(0.7);
      pushMsg({ kind: "sys", text: "otak nyala. semua jalan di browser ini — tanpa api, tanpa internet." });
    }
    return sessionRef.current;
  }, [pushMsg]);

  /* -------- stage 1+2: understand + plan -------- */
  const send = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy) return;
      const run = ++runId.current;
      pushMsg({ kind: "you", text: prompt });
      setInput("");
      setReviseOpen(false);
      const session = await ensureSession();
      if (runId.current !== run) return;
      session.brain.reset((Math.random() * 2 ** 31) | 0);
      setPhase("thinking");
      const plan = await session.start(prompt, {
        onPlanLine: (line) => {
          if (runId.current !== run) return;
          pushMsg({ kind: "trace", text: line });
          setCtxTok(session.brain.T);
        },
      });
      if (runId.current !== run) return;
      setCtxTok(session.brain.T);
      pushMsg({ kind: "plan", text: "", plan });
      setPhase("plan");
    },
    [busy, ensureSession, pushMsg],
  );

  /* -------- revision: mutate the current plan -------- */
  const submitRevise = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const session = sessionRef.current;
      if (!session || !text || busy) return;
      const run = ++runId.current;
      pushMsg({ kind: "you", text });
      setInput("");
      setReviseOpen(false);
      setPhase("thinking");
      pushMsg({ kind: "trace", text: "nunggu, aku racik ulang…" });
      const plan = await session.revise(text, {
        onPlanLine: (line) => {
          if (runId.current !== run) return;
          pushMsg({ kind: "trace", text: line });
          setCtxTok(session.brain.T);
        },
      });
      if (runId.current !== run) return;
      setCtxTok(session.brain.T);
      pushMsg({ kind: "plan", text: "", plan });
      setPhase("plan");
    },
    [busy, pushMsg],
  );

  /* -------- stage 3: deep think + generate from scratch -------- */
  const cont = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const run = ++runId.current;
    setPhase("deepthink");
    const cid = pushMsg({ kind: "code", text: "", full: "" });
    codeMsgId.current = cid;
    codeBuf.current = "";
    let thinkFlush = "";
    const code = await session.generateCode({
      onThinkLine: (line) => {
        if (runId.current !== run) return;
        pushMsg({ kind: "trace", text: line });
      },
      onCodeChunk: (chunk) => {
        if (runId.current !== run) return;
        codeBuf.current += chunk;
        patchMsg(cid, { text: codeBuf.current });
        setCtxTok(session.brain.T);
      },
    });
    if (runId.current !== run) return;
    void thinkFlush;
    patchMsg(cid, { text: code, full: code });
    setCtxTok(session.brain.T);
    // validate with the REAL compiler
    const res = compileScript(code.trim());
    pushMsg({
      kind: "status",
      text: res.ok
        ? `compiled OK — ${res.bytes?.length} bytes of WASM · hooks: ${res.hooks.join(", ")}`
        : `compiler gagal: ${res.errors.slice(0, 2).join(" · ")} — coba revisi atau kirim ulang idenya`,
      ok: res.ok,
      hooks: res.hooks,
      bytes: res.bytes?.length,
    });
    setPhase("result");
  }, [patchMsg, pushMsg]);

  const retry = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const run = ++runId.current;
    setPhase("deepthink");
    pushMsg({ kind: "trace", text: "aku mikir ulang dari awal…" });
    // rewind: re-run plan + code on a fresh brain with the same idea
    const lastYou = [...msgs].reverse().find((m) => m.kind === "you" && !m.text.startsWith("lebih") && !m.text.startsWith("jangan"));
    const idea = lastYou?.text ?? "mode vampir: dealer heal tiap player kena";
    session.brain.reset((Math.random() * 2 ** 31) | 0);
    await session.start(idea, { onPlanLine: (line) => {
      if (runId.current !== run) return;
      pushMsg({ kind: "trace", text: line });
    } });
    if (runId.current !== run) return;
    const cid = pushMsg({ kind: "code", text: "", full: "" });
    codeBuf.current = "";
    const code = await session.generateCode({
      onThinkLine: () => {},
      onCodeChunk: (chunk) => {
        if (runId.current !== run) return;
        codeBuf.current += chunk;
        patchMsg(cid, { text: codeBuf.current });
      },
    });
    if (runId.current !== run) return;
    patchMsg(cid, { text: code, full: code });
    const res = compileScript(code.trim());
    pushMsg({
      kind: "status",
      text: res.ok
        ? `compiled OK — ${res.bytes?.length} bytes of WASM · hooks: ${res.hooks.join(", ")}`
        : `masih gagal: ${res.errors.slice(0, 2).join(" · ")}`,
      ok: res.ok,
    });
    setPhase("result");
  }, [msgs, patchMsg, pushMsg]);

  const codeMsg = [...msgs].reverse().find((m) => m.kind === "code");
  const lastOk = [...msgs].reverse().find((m) => m.kind === "status" && m.ok);
  const lastStatusIdx = [...msgs].reverse().findIndex((m) => m.kind === "status");
  const lastStatus = lastStatusIdx >= 0 ? msgs[msgs.length - 1 - lastStatusIdx] : null;

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

  const ctxPct = Math.min(100, Math.round((ctxTok / MAXT) * 100));

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
            55M param · trained from scratch · no api
          </span>
          <button
            className="rounded border border-[#8f6ad4]/40 px-2 py-0.5 font-mono text-xs text-[#c9b3ec] hover:bg-[#8f6ad4]/20"
            onClick={() => {
              runId.current++;
              sessionRef.current = null;
              setMsgs([]);
              setPhase("idle");
              setReviseOpen(false);
              setCtxTok(0);
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
                      <div className="font-mono text-[15px] font-bold uppercase tracking-wide text-[#d9c9ff]">
                        {p.title || "tanpa judul"}
                      </div>
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] italic text-[#9d8cc7]">{p.tagline}</div>
                    <div className="mt-2 flex flex-col gap-1">
                      {p.bullets.map((b, i) => (
                        <div key={i} className="flex items-start gap-2 font-mono text-[12px] text-[#c9b3ec]">
                          <span className="text-[#7b4fd4]">◆</span>
                          <span>{b}</span>
                        </div>
                      ))}
                      {p.theme && (
                        <div className="flex items-center gap-2 font-mono text-[12px] text-[#8f7ab0]">
                          <span className="text-[#5e4a8f]">◇</span>
                          <span>ruangan: {p.theme}</span>
                        </div>
                      )}
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
                      roulteematescript — written live, token by token
                    </div>
                    <pre className="roult-code max-h-72 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-snug text-[#b8e0c0]">
                      {m.text}
                      {phase === "deepthink" && m.id === codeMsgId.current && (
                        <span className="caret-blink">▌</span>
                      )}
                    </pre>
                  </div>
                );
              }
              // status
              const showActions = m.ok && m.id === (lastStatus?.id ?? -1);
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
                  {showActions && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!lastOk && (
                        <button
                          className="rounded border border-[#8f6ad4]/50 px-3 py-1 font-mono text-xs text-[#c9b3ec] hover:bg-[#8f6ad4]/20"
                          onClick={retry}
                        >
                          MIKIR ULANG
                        </button>
                      )}
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
                    </div>
                  )}
                </div>
              );
            })}
            {busy && (
              <div className="flex items-center gap-2 font-mono text-[12px] text-[#6d5a96]">
                <span className="caret-blink text-[#7b4fd4]">▌</span>
                <span>
                  {phase === "loading"
                    ? "loading weights…"
                    : phase === "codegen"
                      ? "writing…"
                      : phase === "deepthink"
                        ? "deep thinking…"
                        : "thinking…"}
                </span>
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
              {ctxTok} / {MAXT} tok
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
