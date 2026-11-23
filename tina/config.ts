import { defineConfig } from "tinacms";
import { IMAGE_MIME_TYPES } from "../lib/content-rules.mjs";
import { collections } from "./collections";

// The editor always reads and saves on `edits`. Saves reach `production`
// only after the content checks pass.
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
  schema: { collections },
});
