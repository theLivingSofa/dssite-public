import Site, { noField } from "../components/Site";
import { loadSite } from "../lib/content";

export default function Home() {
  return (
    <>
      <Site data={loadSite()} field={noField} />
      <script src="/js/main.js" defer />
    </>
  );
}
