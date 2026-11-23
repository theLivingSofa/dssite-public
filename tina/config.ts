import { defineConfig } from "tinacms";
import { IMAGE_MIME_TYPES } from "../lib/content-rules.mjs";
import { collections } from "./collections";
import { draftForm, installDrafts } from "./drafts";

// Save draft stays in the browser. Publish writes to `edits`, and changes reach
// `production` only after the content checks pass.
const branch = "edits";

export default defineConfig({
  branch,
  clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID,
  // Read-only and build-time only. The site never imports the client that holds it.
  token: process.env.TINA_TOKEN,
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
  media: {
    accept: IMAGE_MIME_TYPES,
    tina: {
      mediaRoot: "assets/img",
      publicFolder: "public",
    },
  },
  // Every section is a single document, so Tina's back arrow would reopen the same one.
  // In the page preview it shows the list of sections instead, and keeps unsaved changes.
  cmsCallback: (cms) => {
    installDrafts(cms);
    if (typeof document !== "undefined") {
      document.addEventListener(
        "click",
        (event) => {
          const back = (event.target as Element | null)?.closest?.('button[aria-label^="Back to "]');
          if (!back || !window.location.hash.startsWith("#/~")) return;
          event.preventDefault();
          event.stopPropagation();
          cms.dispatch({ type: "forms:set-active-form-id", value: null });
        },
        true,
      );
    }
    return cms;
  },
  formifyCallback: draftForm as never,
  schema: { collections },
});
