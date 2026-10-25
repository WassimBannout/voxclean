import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import App from "../App";
import "../index.css";
import { ErrorGallery } from "./ErrorGallery";
import { fixtureState } from "./fixtures";
import { installMockBackend } from "./mockBackend";

// The app against a fake backend. `?screen=<name>` opens a screen directly in
// the state its design artboard shows (see design/screens.json).
const params = new URLSearchParams(window.location.search);
installMockBackend(params);
const screen = params.get("screen");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {screen === "errors" ? (
      <ErrorGallery />
    ) : (
      <App initialState={fixtureState(screen)} />
    )}
  </React.StrictMode>,
);
