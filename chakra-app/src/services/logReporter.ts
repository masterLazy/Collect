/**
 * Frontend log reporter.
 *
 * Intercepts console.log/warn/error and sends the entries to the backend
 * via POST /api/logs/frontend so they appear in the WPF log viewer.
 *
 * Activated once on import — include via `import "./services/logReporter"`.
 */

const API = "/api/logs/frontend";

/** Send one log entry to the backend (fire-and-forget). */
function send(level: string, message: string, exception?: string) {
    try {
        fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ level, message, exception: exception ?? null }),
        }).catch(() => {
            /* swallow — don't create infinite loops */
        });
    } catch {
        /* swallow */
    }
}

/* ── save original methods ─────────────────────────── */
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

/* ── intercept ─────────────────────────────────────── */
console.log = function (...args: unknown[]) {
    origLog.apply(console, args);
    const msg = args.map((a) => (typeof a === "object" ? safeStringify(a) : String(a))).join(" ");
    send("Information", msg);
};

console.warn = function (...args: unknown[]) {
    origWarn.apply(console, args);
    const msg = args.map((a) => (typeof a === "object" ? safeStringify(a) : String(a))).join(" ");
    send("Warning", msg);
};

console.error = function (...args: unknown[]) {
    origError.apply(console, args);
    const msg = args.map((a) => (typeof a === "object" ? safeStringify(a) : String(a))).join(" ");
    const ex = args.find((a) => a instanceof Error) as Error | undefined;
    send("Error", msg, ex?.stack);
};

/* ── helpers ────────────────────────────────────────── */
function safeStringify(obj: unknown): string {
    try {
        return JSON.stringify(obj, null, 0);
    } catch {
        return String(obj);
    }
}

/* Export something to make this a module (required by --isolatedModules). */
export { };
