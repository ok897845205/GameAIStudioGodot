import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./studio";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

// New ChatGPT-style dual-stage layout is the default and the only view that
// loads global CSS eagerly (Tailwind via index.css). The legacy control panel
// and the chat demo are lazy-loaded so the legacy `styles.css` (unlayered
// element rules that would override Tailwind) only ships when actually opened.
//   #legacy     → the previous dense control panel
//   #chat-demo  → the in-memory streaming chat harness
const LegacyApp = lazy(() =>
  import("./app").then((m) => ({ default: m.App })),
);
const ChatDemo = lazy(() =>
  import("./components/chat").then((m) => ({ default: m.ChatDemo })),
);

const hash = typeof window !== "undefined" ? window.location.hash : "";

const root =
  hash === "#legacy" ? (
    <Suspense fallback={null}>
      <LegacyApp />
    </Suspense>
  ) : hash === "#chat-demo" ? (
    <Suspense fallback={null}>
      <ChatDemo />
    </Suspense>
  ) : (
    <StudioApp />
  );

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>{root}</ThemeProvider>
  </React.StrictMode>,
);
