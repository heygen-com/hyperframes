import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing from index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
