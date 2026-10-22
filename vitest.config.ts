import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const alias = {
  "@": path.resolve(__dirname, "./src"),
};

export default defineConfig({
  resolve: {
    alias,
    // Resolves `import "server-only"` to its no-op build (the same
    // condition Next.js sets when bundling Server Components) so
    // repository tests can import server-only modules under plain Node.
    conditions: ["react-server"],
  },
  ssr: {
    resolve: {
      conditions: ["react-server"],
    },
  },
  test: {
    // Split into two projects rather than one flat config: the "react-server"
    // resolve condition above is required for every other test file (it's
    // how `import "server-only"` resolves under plain Node), but it makes
    // `react-dom/client` refuse to resolve at all ("react-dom/client is not
    // supported in React Server Components" — react-dom's own package.json
    // "exports" map picks that condition first when it's present). The one
    // test file that needs genuine `react-dom/client` behavior (mounting a
    // real React tree under real `React.StrictMode` — see
    // `cart-context.strict-mode.test.ts`'s own doc comment) needs the
    // OPPOSITE: no "react-server" condition, so `react-dom/client` resolves
    // normally. Everything else keeps today's exact settings, unchanged.
    projects: [
      {
        resolve: {
          alias,
          conditions: ["react-server"],
        },
        ssr: {
          resolve: {
            conditions: ["react-server"],
          },
        },
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.strict-mode.test.ts", "src/**/*.client.test.ts"],
        },
      },
      {
        // `tsconfig.json` sets `jsx: "preserve"` (Next.js's own SWC
        // transform does the real work at build time) — under Vitest,
        // nothing else performs that transform unless a plugin does, so
        // this one project (and only this one) gets `@vitejs/plugin-react`
        // to make `cart-context.tsx`'s JSX parseable here.
        plugins: [react()],
        resolve: {
          alias,
        },
        test: {
          name: "client",
          environment: "jsdom",
          // `*.strict-mode.test.ts` is the original, narrowly-named file
          // (React Strict Mode's double-invoked mount effects).
          // `*.client.test.ts` is the general name for any OTHER test
          // that likewise needs a real DOM and `react-dom/client` (e.g.
          // mounting a Client Component and dispatching real DOM
          // events) — added for Chat 3 Finding 3's
          // `admin-inventory-adjust-form` regression tests. Both stay
          // plain `.test.ts` (never `.test.tsx`), consistent with
          // `cart-context.strict-mode.test.ts`'s own documented reason
          // for using `React.createElement` instead of JSX.
          include: ["src/**/*.strict-mode.test.ts", "src/**/*.client.test.ts"],
        },
      },
    ],
  },
});
