/**
 * Voice input for the AI assistant: the browser's own speech recognition (the
 * Web Speech API). Fintranzact does not receive, record or store any audio and
 * no speech service of ours is involved. Depending on the browser, the browser
 * itself may send the audio to its vendor's speech service to turn it into
 * text (Chrome and Edge do; the help page says so).
 *
 * The transcript only fills the question box. It is NEVER sent automatically:
 * the person reads it, corrects it and presses Send.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** The few members of SpeechRecognition used here (the DOM lib does not ship its types everywhere). */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's recognition constructor, or null when it has none (Firefox, some in-app browsers). */
export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const SPEECH_UNSUPPORTED_HINT = "Voice input is not available in this browser. You can type your question, or try Chrome, Edge or Safari.";
export const SPEECH_LISTENING = "Listening. Speak your question. Tap the microphone or press Esc to stop.";
export const SPEECH_STOPPED = "Stopped listening. Check your question, then press Send.";

/** A plain message for a recognition error code; null for "aborted" (the person stopped it, nothing to say). */
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow microphone access for this site in your browser settings, then try again.";
    case "no-speech":
      return "I did not hear anything. Tap the microphone and try again.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected and try again.";
    case "network":
      return "Voice input needs an internet connection to your browser's speech service. Check your connection or type your question.";
    case "language-not-supported":
      return "Your browser cannot recognise this language by voice. Choose another reply language in the assistant preferences, or type your question.";
    default:
      return "Voice input stopped because of a problem. You can try again or type your question.";
  }
}

export interface UseSpeechInputOptions {
  /** BCP 47 language to listen for ("en-IN", "hi-IN", "gu-IN"). */
  lang: string;
  /** What is in the box when listening starts; the transcript is added after it. */
  getBase: () => string;
  /** Called with the full text for the box (base + what was heard so far). */
  onText: (text: string) => void;
  maxChars: number;
}

export interface SpeechInput {
  supported: boolean;
  listening: boolean;
  /** What to announce / show right now ("" = nothing). */
  status: string;
  /** True when `status` is an error. */
  isError: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useSpeechInput(opts: UseSpeechInputOptions): SpeechInput {
  const [supported] = useState(() => getSpeechRecognition() !== null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    const { lang, getBase } = optsRef.current;
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const base = getBase();
    const sep = base && !/\s$/.test(base) ? " " : "";
    let heard = false;
    let failed = false;

    rec.onstart = () => {
      setListening(true);
      setIsError(false);
      setStatus(SPEECH_LISTENING);
    };
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i]?.[0]?.transcript ?? "";
      transcript = transcript.replace(/\s+/g, " ").trim();
      if (!transcript) return;
      heard = true;
      optsRef.current.onText(`${base}${sep}${transcript}`.slice(0, optsRef.current.maxChars));
    };
    rec.onerror = (e) => {
      const message = speechErrorMessage(e.error);
      if (message) {
        failed = true;
        setIsError(true);
        setStatus(message);
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      if (!failed) {
        setIsError(false);
        setStatus(heard ? SPEECH_STOPPED : "");
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setIsError(true);
      setStatus(speechErrorMessage("unknown")!);
    }
  }, []);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else {
      setStatus("");
      setIsError(false);
      start();
    }
  }, [start, stop]);

  // A different language, or leaving the page, ends the recognition (the browser releases the microphone).
  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        rec.abort();
        recRef.current = null;
        setListening(false);
        setStatus("");
      }
    };
  }, [opts.lang]);

  return { supported, listening, status, isError, toggle, stop };
}
