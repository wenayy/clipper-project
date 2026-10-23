import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ToastProvider from "./Toast";
import SharePage, { shareToken } from "./SharePage";
import "./posthog";
import "./styles.css";
import "./polish.css";
import "./wizard.css";

/* /s/<token> is the only public path, so it is resolved here rather than by
   pulling in a router for one route. */
const token = shareToken();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      {token ? <SharePage token={token} /> : <App />}
    </ToastProvider>
  </React.StrictMode>
);
