import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "./index.css";

import { router } from "./app/router";
import AuthProvider from "./context/AuthProvider";
import { MediaPlayerProvider } from "./shared/media/MediaPlayerContext";
import GlobalMiniPlayer from "./shared/media/GlobalMiniPlayer";


createRoot(document.getElementById("root")).render(
  <StrictMode>

    <AuthProvider>
      <MediaPlayerProvider>
        <RouterProvider router={router} />
        <GlobalMiniPlayer />
      </MediaPlayerProvider>
    </AuthProvider>

  </StrictMode>
);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
