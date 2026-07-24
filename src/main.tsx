import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { I18nProvider, translateCurrent } from "./i18n";
import "./styles.css";

const initialTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;

const updateServiceWorker = registerSW({
  onNeedRefresh() {
    if (window.confirm(translateCurrent("pwa.update.confirm"))) void updateServiceWorker(true);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
