import type { Metadata } from "next";
import { SiteDocument } from "../../tina/__generated__/types";
import EditPreview from "./EditPreview";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Ships with no content. Inside /admin, Tina fetches the content with the editor's login
// and sends it to this page, so anyone opening /edit/ directly sees no site data at all
// (no hidden sources, no unpublished settings).
export default function EditPage() {
  return <EditPreview data={{}} query={SiteDocument} variables={{}} />;
}
