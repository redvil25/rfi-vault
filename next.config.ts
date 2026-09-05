import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Only the Supabase origin is reachable from the browser. Derived from the same
// env var the client uses, so it cannot drift.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Clickjacking: this app is never legitimately framed.
  "frame-ancestors 'none'",
  "form-action 'self'",
  `connect-src 'self' ${supabaseOrigin}`.trim(),
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Tailwind injects styles inline; there is no nonce plumbing for them.
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-inline' is required by Next's bootstrap scripts, and Turbopack dev
  // additionally needs 'unsafe-eval'. Tightening this to a nonce-based policy
  // needs the nonce threaded through proxy.ts and is a known follow-up.
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Only meaningful over HTTPS; harmless locally.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up and finds a stray
  // package-lock.json in the user's home directory and warns on every build.
  turbopack: {
    root: path.resolve(__dirname),
  },

  // Fail the production build on type errors. The demo depends on this repo
  // staying green — see CLAUDE.md §7. Next 16 no longer runs ESLint during
  // `next build`, so linting is enforced separately in CI.
  typescript: { ignoreBuildErrors: false },

  // Do not advertise the framework.
  poweredByHeader: false,

  // unpdf ships WASM and worker assets; @huggingface/transformers loads ONNX
  // runtimes and model weights at runtime. Neither survives being bundled into
  // a chunk, and the embedding model additionally needs its native or WASM
  // backend resolvable from node_modules rather than from a trace.
  serverExternalPackages: ["unpdf", "@huggingface/transformers", "onnxruntime-node"],

  // onnxruntime-node loads libonnxruntime.so.1 by path at runtime, and nothing
  // in the source refers to it, so file tracing cannot see it and leaves it
  // behind. The symptom is only visible in production: importing
  // @huggingface/transformers throws "libonnxruntime.so.1: cannot open shared
  // object file", which takes every embedding path down while the rest of the
  // page keeps working.
  //
  // Linux only — the darwin and win32 binaries in that package are another
  // 160 MB and no function will ever load them.
  outputFileTracingIncludes: {
    "/search": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**"],
    "/suggest": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**"],
    "/report-check": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**"],
    "/rfi/[id]": ["./node_modules/onnxruntime-node/bin/napi-v6/linux/**"],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
