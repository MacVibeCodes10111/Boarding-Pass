import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CrashScreen } from "./components/CrashScreen";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </React.StrictMode>,
);
