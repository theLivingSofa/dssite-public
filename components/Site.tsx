import { Fragment, type ReactNode } from "react";
import { DISCLAIMER, safeHref } from "../lib/content-rules.mjs";
import { responsive } from "../lib/images";
import type { SiteQuery } from "../tina/__generated__/types";

// The whole page. The public route passes `noField`; the editor route passes a
// function that marks each element with its Tina field for click-to-edit.
export type FieldFn = (object: never, property: string, index?: number) => Record<string, string> | undefined;

export const noField: FieldFn = () => undefined;

type Editable = { field: FieldFn };
type Link = { label?: string | null; url?: string | null } | null;

const GALLERY_SLOTS = [
  { slot: "a", sizes: "(min-width: 900px) 62vw, 100vw", target: 800 },
  { slot: "b", sizes: "(min-width: 900px) 28vw, 100vw", target: 800 },
  { slot: "c", sizes: "(min-width: 900px) 86vw, 100vw", target: 1200 },
  { slot: "d", sizes: "(min-width: 900px) 48vw, 100vw", target: 800 },
  { slot: "e", sizes: "(min-width: 900px) 38vw, 100vw", target: 800 },
  { slot: "f", sizes: "(min-width: 900px) 62vw, 100vw", target: 1200 },
  { slot: "g", sizes: "(min-width: 900px) 28vw, 100vw", target: 800 },
];

const mark = (field: FieldFn, object: unknown, property: string, index?: number) =>
  field(object as never, property, index);

const linkTo = (url?: string | null) => {
  const href: string | undefined = safeHref(url);
  return href?.startsWith("https:") ? { href, rel: "noopener noreferrer" } : { href };
};

// Words wrapped in *stars* render in italics.
function Inline({ text }: { text?: string | null }) {
  if (!text) return null;
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    /^\*[^*]+\*$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i> : <Fragment key={i}>{part}</Fragment>,
  );
}

// Bare text that sits next to other inline content. It only needs an element in the editor.
function Bare({ field, object, property, children }: Editable & { object: unknown; property: string; children: ReactNode }) {
  const props = mark(field, object, property);
  return props ? <span {...props}>{children}</span> : <>{children}</>;
}

function Links({ items, separator, field }: Editable & { items?: (Link | null)[] | null; separator: string }) {
  return items?.map((link, i) => (
    <Fragment key={i}>
      {i > 0 && separator}
      <a {...linkTo(link?.url)} {...mark(field, link, "label")}>{link?.label}</a>
    </Fragment>
  ));
}

function Rail({ number, section, field }: Editable & { number: string; section: { railLabel?: string | null } }) {
  return (
    <div className="rail">
      <span className="rail__num" aria-hidden="true">{number}</span>
      <span className="rail__label sc" {...mark(field, section, "railLabel")}>{section.railLabel}</span>
    </div>
  );
}

function SourceLine({ section, field }: Editable & { section: { sourcesLabel?: string | null; sources?: (Link | null)[] | null } }) {
  return (
    <p className="srcline">
      <Bare field={field} object={section} property="sourcesLabel">{section.sourcesLabel}</Bare>{" "}
      <Links items={section.sources} separator="; " field={field} />.
    </p>
  );
}

export default function Site({ data, field }: { data: SiteQuery; field: FieldFn }) {
  const { settings, hero, profile, quote, timeline, research, institute, roles, gallery, contact, footer } = data;
  const f = (object: unknown, property: string, index?: number) => mark(field, object, property, index);
  const portrait = responsive(hero.portrait, 480);

  return (
    <>
      <div className="progress" aria-hidden="true" />
      <a className="skip" href="#main">Skip to content</a>

      <header className="mast" role="banner">
        <details className="mast__nav">
          <summary><span className="sc" {...f(settings, "menuLabel")}>{settings.menuLabel}</span></summary>
          <nav aria-label="Sections">
            <ol>
              {settings.nav?.map((item, i) => (
                <li key={i}><a href={`#${item?.anchor}`} {...f(item, "label")}>{item?.label}</a></li>
              ))}
            </ol>
          </nav>
        </details>
      </header>

      <main id="main">
        <section className="hero wrap" aria-labelledby="name">
          <figure className="hero__fig">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...portrait}
              sizes="(min-width: 900px) 38vw, 100vw"
              fetchPriority="high"
              decoding="async"
              alt={hero.portraitAlt ?? ""}
              {...f(hero, "portrait")}
            />
            <figcaption><span {...f(hero, "portraitCredit")}>{hero.portraitCredit}</span></figcaption>
          </figure>

          <p className="hero__role sc" {...f(hero, "role")}>{hero.role}</p>
          <h1 id="name" className="hero__name">
            <span className="hon" {...f(hero, "honorific")}>{hero.honorific}</span>{" "}
            <span className="ln"><span {...f(hero, "firstName")}>{hero.firstName}</span></span>{" "}
            <span className="ln"><span {...f(hero, "lastName")}>{hero.lastName}</span></span>
          </h1>
          <p className="hero__line" {...f(hero, "line")}>{hero.line}</p>

          <dl className="hero__facts">
            {hero.facts?.map((fact, i) => (
              <div key={i}>
                <dt className="sc" {...f(fact, "label")}>{fact?.label}</dt>
                <dd {...f(fact, "value")}>{fact?.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="profile" className="sec wrap" aria-labelledby="h-profile">
          <Rail number="01" section={profile} field={field} />
          <div className="body reveal">
            <h2 id="h-profile" className="h2" {...f(profile, "heading")}>{profile.heading}</h2>
            <p className="lead fill" {...f(profile, "lead")}>{profile.lead}</p>
            {profile.paragraphs?.map((paragraph, i) => (
              <p key={i} {...f(paragraph, "text")}><Inline text={paragraph?.text} /></p>
            ))}
            <SourceLine section={profile} field={field} />
          </div>
        </section>

        <section className="quote wrap" aria-label="From the Director's Message">
          <figure className="quote__fig reveal">
            <blockquote><p {...f(quote, "text")}>{quote.text}</p></blockquote>
            <figcaption>
              <Bare field={field} object={quote} property="captionBefore">{quote.captionBefore}</Bare>{" "}
              <a {...linkTo(quote.linkUrl)} {...f(quote, "linkLabel")}>{quote.linkLabel}</a>
              <Bare field={field} object={quote} property="captionAfter">{quote.captionAfter}</Bare>
            </figcaption>
          </figure>
        </section>

        <section id="timeline" className="tl" aria-labelledby="h-timeline">
          <div className="tl__pin">
            <div className="tl__intro wrap">
              <Rail number="02" section={timeline} field={field} />
              <div className="body body--wide">
                <h2 id="h-timeline" className="h2 reveal" {...f(timeline, "heading")}>{timeline.heading}</h2>
              </div>
            </div>
            <div className="tl__list wrap">
              <ol className="timeline">
                {timeline.entries?.map((entry, i) => (
                  <li key={i}>
                    <time className="timeline__when" dateTime={entry?.datetime || undefined} {...f(entry, "when")}>{entry?.when}</time>
                    <div>
                      <h3 className="h3" {...f(entry, "title")}>{entry?.title}</h3>
                      <p {...f(entry, "text")}>{entry?.text}</p>
                      <p className="src"><Links items={entry?.sources} separator=" · " field={field} /></p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="tl__bar" aria-hidden="true"><span /></div>
          </div>
        </section>

        <section id="research" className="sec wrap" aria-labelledby="h-research">
          <Rail number="03" section={research} field={field} />
          <div className="body body--wide">
            <h2 id="h-research" className="h2 reveal" {...f(research, "heading")}>{research.heading}</h2>
            <div className="research">
              <div className="reveal">
                <p className="lead fill" {...f(research, "lead")}>{research.lead}</p>
                <dl className="areas">
                  {research.areas?.map((area, i) => (
                    <div key={i}>
                      <dt {...f(area, "name")}>{area?.name}</dt>
                      <dd {...f(area, "description")}>{area?.description}</dd>
                    </div>
                  ))}
                </dl>
                <SourceLine section={research} field={field} />
              </div>

              <div className="research__side reveal">
                {research.notes?.map((note, i) => (
                  <Fragment key={i}>
                    <h3 className="h3" {...f(note, "heading")}>{note?.heading}</h3>
                    <p {...f(note, "text")}>{note?.text}</p>
                  </Fragment>
                ))}
              </div>
            </div>

            <h3 className="h3 h3--rule reveal" {...f(research, "papersHeading")}>{research.papersHeading}</h3>
            <ol className="pubs reveal">
              {research.papers?.map((paper, i) => (
                <li key={i}>
                  <span className="pubs__yr" {...f(paper, "year")}>{paper?.year}</span>
                  <span>
                    <a {...linkTo(paper?.url)} {...f(paper, "title")}>{paper?.title}</a>
                    <br />
                    <i {...f(paper, "journal")}>{paper?.journal}</i>,{" "}
                    <Bare field={field} object={paper} property="coauthors">{paper?.coauthors}</Bare>
                  </span>
                </li>
              ))}
            </ol>

            <h3 className="h3 h3--rule reveal" {...f(research, "booksHeading")}>{research.booksHeading}</h3>
            <p className="reveal">
              {research.books?.map((book, i) => (
                <Fragment key={i}>
                  {i > 0 && "; "}
                  <i {...f(book, "title")}>{book?.title}</i>{" ("}
                  <Bare field={field} object={book} property="publisher">{book?.publisher}</Bare>)
                </Fragment>
              ))}.
            </p>
          </div>
        </section>

        <section id="institute" className="sec sec--deep wrap" aria-labelledby="h-institute">
          <Rail number="04" section={institute} field={field} />
          <div className="body body--wide">
            <h2 id="h-institute" className="h2 reveal" {...f(institute, "heading")}>{institute.heading}</h2>
            {institute.ledgers?.map((ledger, i) => (
              <div className="ledger reveal" key={i}>
                <h3 className="ledger__head sc" {...f(ledger, "heading")}>{ledger?.heading}</h3>
                <dl>
                  {ledger?.rows?.map((row, j) => (
                    <div key={j}>
                      <dt {...f(row, "label")}>{row?.label}</dt>
                      <dd {...f(row, "text")}>{row?.text}</dd>
                      <dd className="src"><a {...linkTo(row?.sourceUrl)} {...f(row, "sourceLabel")}>{row?.sourceLabel}</a></dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>

        <section id="roles" className="sec wrap" aria-labelledby="h-roles">
          <Rail number="05" section={roles} field={field} />
          <div className="body body--wide">
            <h2 id="h-roles" className="h2 reveal" {...f(roles, "heading")}>{roles.heading}</h2>
            <div className="roles reveal">
              <dl>
                {roles.roles?.map((role, i) => (
                  <div key={i}>
                    <dt {...f(role, "label")}>{role?.label}</dt>
                    <dd {...f(role, "text")}><Inline text={role?.text} /></dd>
                  </div>
                ))}
              </dl>
              <SourceLine section={roles} field={field} />
            </div>
          </div>
        </section>

        <section id="gallery" className="sec sec--deep wrap gallery" aria-labelledby="h-gallery">
          <Rail number="06" section={gallery} field={field} />
          <div className="body body--wide">
            <h2 id="h-gallery" className="h2 reveal" {...f(gallery, "heading")}>{gallery.heading}</h2>
          </div>

          {gallery.items?.slice(0, GALLERY_SLOTS.length).map((item, i) => {
            const { slot, sizes, target } = GALLERY_SLOTS[i];
            return (
              <figure className={`g g--${slot} reveal`} key={i}>
                <div className="frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    {...responsive(item?.image, target)}
                    sizes={sizes}
                    loading="lazy"
                    decoding="async"
                    alt={item?.alt ?? ""}
                    {...f(item, "image")}
                  />
                </div>
                <figcaption>
                  <Bare field={field} object={item} property="caption">{item?.caption}</Bare>{" "}
                  <span className="credit" {...f(item, "credit")}>{item?.credit}</span>
                </figcaption>
              </figure>
            );
          })}
        </section>

        <section id="contact" className="sec wrap" aria-labelledby="h-contact">
          <Rail number="07" section={contact} field={field} />
          <div className="body body--wide">
            <h2 id="h-contact" className="h2 reveal" {...f(contact, "heading")}>{contact.heading}</h2>
            <div className="contact reveal">
              {contact.columns?.map((column, i) => (
                <div className="contact__col" key={i}>
                  <h3 className="sc" {...f(column, "heading")}>{column?.heading}</h3>
                  <ul>
                    {column?.rows?.map((row, j) => (
                      <li key={j}>
                        <span className="k" {...f(row, "label")}>{row?.label}</span>
                        {row?.href ? (
                          <a {...linkTo(row.href)} {...f(row, "value")}>{row.value}</a>
                        ) : (
                          <Bare field={field} object={row} property="value">{row?.value}</Bare>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="src">
                    <Bare field={field} object={contact} property="sourcePrefix">{contact.sourcePrefix}</Bare>{" "}
                    <a {...linkTo(column?.sourceUrl)} {...f(column, "sourceLabel")}>{column?.sourceLabel}</a>
                  </p>
                </div>
              ))}
            </div>
            <p className="official reveal">
              <a className="official__link" {...linkTo(contact.officialUrl)} {...f(contact, "officialLabel")}>{contact.officialLabel}</a>
            </p>
          </div>
        </section>
      </main>

      <footer className="foot" role="contentinfo">
        <div className="wrap foot__grid">
          <div className="foot__notice">
            <h2 className="sc" {...f(footer, "heading")}>{footer.heading}</h2>
            <p><a {...linkTo(footer.linkUrl)} {...f(footer, "linkLabel")}>{footer.linkLabel}</a></p>
            <p>{DISCLAIMER}</p>
            <p className="foot__date">
              <Bare field={field} object={footer} property="updatedLabel">{footer.updatedLabel}</Bare>{" "}
              <time dateTime={footer.updatedDate ?? undefined} {...f(footer, "updatedText")}>{footer.updatedText}</time>
            </p>
          </div>
          <div className="foot__src">
            <h2 className="sc" {...f(footer, "sourcesHeading")}>{footer.sourcesHeading}</h2>
            <ol>
              {footer.sources?.map((source, i) => (
                <li key={i}><a {...linkTo(source?.url)} {...f(source, "label")}>{source?.label}</a></li>
              ))}
            </ol>
          </div>
        </div>
      </footer>
    </>
  );
}
