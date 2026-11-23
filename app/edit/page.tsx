import type { Metadata } from "next";
import { loadSite } from "../../lib/content";
import { SiteDocument } from "../../tina/__generated__/types";
import EditPreview from "./EditPreview";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Starts from the files of this commit. Inside /admin, Tina replaces this with live data.
export default function EditPage() {
  return <EditPreview data={loadSite()} query={SiteDocument} variables={{}} />;
}
