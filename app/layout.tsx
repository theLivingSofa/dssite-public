import type { ReactNode } from "react";
import { loadSite } from "../lib/content";
import { responsive } from "../lib/images";

const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%2316130F'/%3E%3Ctext x='16' y='23' text-anchor='middle' font-family='Georgia,serif' font-size='20' fill='%23F3EEE4'%3ED%3C/text%3E%3C/svg%3E";

export default function RootLayout({ children }: { children: ReactNode }) {
  const { settings: s, hero } = loadSite();
  const person = s.person;
  const portrait = responsive(hero.portrait, 480);
  const shareImage = new URL(s.shareImage ?? "/assets/img/og.jpg", s.siteUrl ?? undefined).href;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person?.name,
    honorificPrefix: person?.honorificPrefix,
    jobTitle: person?.jobTitle,
    description: person?.description,
    worksFor: { "@type": "CollegeOrUniversity", name: person?.worksForName, url: person?.worksForUrl },
    alumniOf: { "@type": "CollegeOrUniversity", name: person?.alumniOf },
    knowsAbout: person?.knowsAbout,
    sameAs: person?.sameAs,
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>{s.title}</title>
        <meta name="description" content={s.description ?? undefined} />
        <meta name="theme-color" content="#F3EEE4" />
        <link rel="canonical" href={s.siteUrl ?? undefined} />

        <meta property="og:type" content="profile" />
        <meta property="og:site_name" content={s.siteName ?? undefined} />
        <meta property="og:title" content={s.shareTitle ?? undefined} />
        <meta property="og:description" content={s.shareDescription ?? undefined} />
        <meta property="og:url" content={s.siteUrl ?? undefined} />
        <meta property="og:image" content={shareImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={s.shareImageAlt ?? undefined} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={s.shareTitle ?? undefined} />
        <meta name="twitter:description" content={s.shareDescription ?? undefined} />
        <meta name="twitter:image" content={shareImage} />

        <link rel="icon" href={ICON} />
        <link rel="preload" href="/assets/fonts/newsreader-var.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/assets/fonts/hanken-grotesk-var.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link
          rel="preload"
          as="image"
          href={portrait.src}
          imageSrcSet={portrait.srcSet}
          imageSizes="(min-width: 900px) 38vw, 100vw"
          fetchPriority="high"
        />
        <link rel="stylesheet" href="/css/main.css" />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
