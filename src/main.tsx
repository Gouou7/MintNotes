import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { Confirmation, useConfirmation } from "./components/Confirmation";
import { createPwaUpdatePrompt, waitForPwaUpdateSurface } from "./features/pwaUpdate";
import { applyDocumentTheme } from "./features/theme";
import { I18nProvider, translateCurrent } from "./i18n";
import "./styles.css";

const initialTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
applyDocumentTheme(initialTheme);

let updatePending = false;
let promptForUpdate: (() => void) | undefined;
const updateServiceWorker = registerSW({
  onNeedRefresh() {
    updatePending = true;
    promptForUpdate?.();
  }
});

function PwaUpdateConfirmation() {
  const { request, current } = useConfirmation();
  useEffect(() => {
    const controller = new AbortController();
    const prompt = createPwaUpdatePrompt({
      message: () => translateCurrent("pwa.update.confirm"),
      applyUpdate: () => updateServiceWorker(true),
      waitForSurface: () => waitForPwaUpdateSurface(controller.signal),
      confirmUpdate: (message) => request({
        title: translateCurrent("pwa.update.title"),
        action: translateCurrent("pwa.update.action"),
        message
      }, controller.signal)
    });
    const check = () => {
      if (controller.signal.aborted || !updatePending) return;
      updatePending = false;
      void prompt();
    };
    promptForUpdate = check;
    queueMicrotask(check);
    return () => {
      controller.abort();
      promptForUpdate = undefined;
    };
  }, [request]);
  return <Confirmation current={current} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
      <PwaUpdateConfirmation />
    </I18nProvider>
  </StrictMode>
);
