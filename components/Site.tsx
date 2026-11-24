import { Fragment, type ReactNode } from "react";
import { safeHref } from "../lib/content-rules.mjs";
import { fontChoice } from "../lib/fonts.mjs";
import { responsive } from "../lib/images";
import type { SiteQuery } from "../tina/__generated__/types";

// The whole page. The public route passes `noField`; the editor route passes a
// function that marks each element with its Tina field for click-to-edit.
export type FieldFn = (object: never, property: string, index?: number) => Record<string, string> | undefined;

export const noField: FieldFn = () => undefined;

type Editable = { field: FieldFn };
type Link = { label?: string | null; url?: string | null; keepSource?: boolean | null } | null;

const GALLERY_SLOTS = [
  { slot: "a", sizes: "(min-width: 900px) 62vw, 100vw", target: 800 },
  { slot: "b", sizes: "(min-width: 900px) 28vw, 100vw", target: 800 },
  { slot: "c", sizes: "(min-width: 900px) 86vw, 100vw", target: 1200 },
  { slot: "d", sizes: "(min-width: 900px) 48vw, 100vw", target: 800 },
  { slot: "e", sizes: "(min-width: 900px) 38vw, 100vw", target: 800 },
  { slot: "f", sizes: "(min-width: 900px) 62vw, 100vw", target: 1200 },
  { slot: "g", sizes: "(min-width: 900px) 28vw, 100vw", target: 800 },
];

// A deleted text is empty. Empty things are left out of the page, so the spacing closes up.
const filled = (...values: unknown[]) => values.some((value) => (typeof value === "string" ? value.trim() !== "" : Boolean(value)));

// The list items that still have something to show in the named fields.
const kept = <T,>(items: readonly (T | null | undefined)[] | null | undefined, ...keys: (keyof T)[]) =>
  (items ?? []).filter((item): item is T => Boolean(item) && keys.some((key) => filled((item as T)[key])));

const labelled = (id: string, heading?: string | null) => (filled(heading) ? { "aria-labelledby": id } : {});

// Editor attributes for one piece of text, plus its own font if it has one.
const mark = (field: FieldFn, object: unknown, property: string, index?: number) => {
  const props = field(object as never, property, index);
  const font = fontChoice((object as Record<string, unknown> | null | undefined)?.[`${property}Font`]);
  return font ? { ...props, "data-font": font } : props;
};

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

// With sources hidden, only the links switched on one by one still show.
const shownLinks = (items: (Link | null)[] | null | undefined, all: boolean) =>
  kept(items as Link[] | null | undefined, "label" as never).filter((link) => all || Boolean(link?.keepSource));

function Links({ items, separator, field, all }: Editable & { items?: (Link | null)[] | null; separator: string; all: boolean }) {
  return shownLinks(items, all).map((link, i) => (
    <Fragment key={i}>
      {i > 0 && separator}
      <a {...linkTo(link?.url)} {...mark(field, link, "label")}>{link?.label}</a>
    </Fragment>
  ));
}

const hasLinks = (items: (Link | null)[] | null | undefined, all: boolean) => shownLinks(items, all).length > 0;

// The section number, with the section heading under it in the margin.
function Rail({ number, children }: { number: string; children?: ReactNode }) {
  return (
    <div className="rail">
      <span className="rail__num" aria-hidden="true">{number}</span>
      {children}
    </div>
  );
}

function SourceLine({ section, field, all }: Editable & { all: boolean; section: { sourcesLabel?: string | null; sources?: (Link | null)[] | null } }) {
  if (!hasLinks(section.sources, all)) return null;
  return (
    <p className="srcline">
      <Bare field={field} object={section} property="sourcesLabel">{section.sourcesLabel}</Bare>{" "}
      <Links items={section.sources} separator="; " field={field} all={all} />.
    </p>
  );
}

export default function Site({ data, field }: { data: SiteQuery; field: FieldFn }) {
  const { settings, hero, profile, quote, timeline, research, institute, roles, gallery, contact, footer } = data;
  const f = (object: unknown, property: string, index?: number) => mark(field, object, property, index);
  const portrait = responsive(hero.portrait, 480);
  // The sources stay saved, so turning this back off restores every line.
  const showSources = !settings.hideSources;

  const facts = kept(hero.facts, "label", "value");
  const paragraphs = kept(profile.paragraphs, "text");
  const entries = kept(timeline.entries, "when", "title", "text");
  const areas = kept(research.areas, "name", "description");
  const notes = kept(research.notes, "heading", "text");
  const papers = kept(research.papers, "year", "title", "journal", "coauthors");
  const books = kept(research.books, "title", "publisher");
  const ledgers = (institute.ledgers ?? [])
    .map((ledger) => ({ ledger, rows: kept(ledger?.rows, "label", "text") }))
    .filter(({ ledger, rows }) => filled(ledger?.heading) || rows.length > 0);
  const roleRows = kept(roles.roles, "label", "text");
  const photos = kept(gallery.items, "image", "caption").slice(0, GALLERY_SLOTS.length);
  const columns = (contact.columns ?? [])
    .map((column) => ({ column, rows: kept(column?.rows, "label", "value") }))
    .filter(({ column, rows }) => filled(column?.heading) || rows.length > 0);
  const footerSources = kept(footer.sources, "label").filter((source) => showSources || Boolean(source.keepSource));

  const researchMain = filled(research.lead) || areas.length > 0;
  const footerNotice = filled(footer.heading, footer.linkLabel, footer.notice, footer.updatedText);

  // A section with nothing left in it disappears, and its menu link goes with it.
  const visible: Record<string, boolean> = {
    profile: filled(profile.heading, profile.lead) || paragraphs.length > 0,
    timeline: filled(timeline.heading) || entries.length > 0,
    research:
      filled(research.heading, research.papersHeading, research.booksHeading) ||
      researchMain || notes.length > 0 || papers.length > 0 || books.length > 0,
    institute: filled(institute.heading) || ledgers.length > 0,
    roles: filled(roles.heading) || roleRows.length > 0,
    gallery: filled(gallery.heading) || photos.length > 0,
    contact: filled(contact.heading, contact.officialLabel) || columns.length > 0,
  };
  const numbers = Object.fromEntries(
    Object.keys(visible).filter((name) => visible[name]).map((name, i) => [name, String(i + 1).padStart(2, "0")]),
  );
  const menu = kept(settings.nav, "label").filter((item) => visible[item.anchor ?? ""] !== false);

  return (
    <>
      <div className="progress" aria-hidden="true" />
      <a className="skip" href="#main">Skip to content</a>

      <header className="mast" role="banner">
        <details className="mast__nav">
          <summary><span className="sc" {...f(settings, "menuLabel")}>{settings.menuLabel}</span></summary>
          <nav aria-label="Sections">
            <ol>
              {menu.map((item, i) => (
                <li key={i}><a href={`#${item?.anchor}`} {...f(item, "label")}>{item?.label}</a></li>
              ))}
            </ol>
          </nav>
        </details>
      </header>

      <main id="main">
        <section className="hero wrap" aria-labelledby="name">
          {filled(hero.portrait) && (
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
              {(showSources || Boolean(hero.keepCredit)) && filled(hero.portraitCredit) && <figcaption><span {...f(hero, "portraitCredit")}>{hero.portraitCredit}</span></figcaption>}
            </figure>
          )}

          {filled(hero.role) && <p className="hero__role sc" {...f(hero, "role")}>{hero.role}</p>}
          <h1 id="name" className="hero__name">
            {filled(hero.honorific) && <span className="hon" {...f(hero, "honorific")}>{hero.honorific}</span>}{" "}
            <span className="ln"><span {...f(hero, "firstName")}>{hero.firstName}</span></span>{" "}
            <span className="ln"><span {...f(hero, "lastName")}>{hero.lastName}</span></span>
          </h1>
          {filled(hero.line) && <p className="hero__line" {...f(hero, "line")}>{hero.line}</p>}

          {facts.length > 0 && (
            <dl className="hero__facts">
              {facts.map((fact, i) => (
                <div key={i}>
                  {filled(fact.label) && <dt className="sc" {...f(fact, "label")}>{fact.label}</dt>}
                  {filled(fact.value) && <dd {...f(fact, "value")}>{fact.value}</dd>}
                </div>
              ))}
            </dl>
          )}
        </section>

        {visible.profile && (
          <section id="profile" className="sec wrap" {...labelled("h-profile", profile.heading)}>
            <Rail number={numbers.profile}>
              {filled(profile.heading) && <h2 id="h-profile" className="h2 reveal" {...f(profile, "heading")}>{profile.heading}</h2>}
            </Rail>
            <div className="body reveal">
              {filled(profile.lead) && <p className="lead fill" {...f(profile, "lead")}>{profile.lead}</p>}
              {paragraphs.map((paragraph, i) => (
                <p key={i} {...f(paragraph, "text")}><Inline text={paragraph.text} /></p>
              ))}
              <SourceLine section={profile} field={field} all={showSources} />
            </div>
          </section>
        )}

        {filled(quote.text, quote.captionBefore, quote.linkLabel, quote.captionAfter) && (
          <section className="quote wrap" aria-label="From the Director's Message">
            <figure className="quote__fig reveal">
              {filled(quote.text) && <blockquote><p {...f(quote, "text")}>{quote.text}</p></blockquote>}
              {filled(quote.captionBefore, quote.linkLabel, quote.captionAfter) && (
                <figcaption>
                  <Bare field={field} object={quote} property="captionBefore">{quote.captionBefore}</Bare>{" "}
                  {filled(quote.linkLabel) && <a {...linkTo(quote.linkUrl)} {...f(quote, "linkLabel")}>{quote.linkLabel}</a>}
                  <Bare field={field} object={quote} property="captionAfter">{quote.captionAfter}</Bare>
                </figcaption>
              )}
            </figure>
          </section>
        )}

        {visible.timeline && (
          <section id="timeline" className="tl" {...labelled("h-timeline", timeline.heading)}>
            <div className="tl__pin">
              <div className="tl__intro wrap">
                <Rail number={numbers.timeline}>
                  {filled(timeline.heading) && <h2 id="h-timeline" className="h2 reveal" {...f(timeline, "heading")}>{timeline.heading}</h2>}
                </Rail>
              </div>
              <div className="tl__list wrap">
                <ol className="timeline">
                  {entries.map((entry, i) => (
                    <li key={i}>
                      {filled(entry.when) && <time className="timeline__when" dateTime={entry.datetime || undefined} {...f(entry, "when")}>{entry.when}</time>}
                      <div>
                        {filled(entry.title) && <h3 className="h3" {...f(entry, "title")}>{entry.title}</h3>}
                        {filled(entry.text) && <p {...f(entry, "text")}>{entry.text}</p>}
                        {hasLinks(entry.sources, showSources) && <p className="src"><Links items={entry.sources} separator=" · " field={field} all={showSources} /></p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="tl__bar" aria-hidden="true"><span /></div>
            </div>
          </section>
        )}

        {visible.research && (
          <section id="research" className="sec wrap" {...labelled("h-research", research.heading)}>
            <Rail number={numbers.research}>
              {filled(research.heading) && <h2 id="h-research" className="h2 reveal" {...f(research, "heading")}>{research.heading}</h2>}
            </Rail>
            <div className="body body--wide">
              {(researchMain || notes.length > 0) && (
                <div className="research">
                  {researchMain && (
                    <div className="reveal">
                      {filled(research.lead) && <p className="lead fill" {...f(research, "lead")}>{research.lead}</p>}
                      {areas.length > 0 && (
                        <dl className="areas">
                          {areas.map((area, i) => (
                            <div key={i}>
                              {filled(area.name) && <dt {...f(area, "name")}>{area.name}</dt>}
                              {filled(area.description) && <dd {...f(area, "description")}>{area.description}</dd>}
                            </div>
                          ))}
                        </dl>
                      )}
                      <SourceLine section={research} field={field} all={showSources} />
                    </div>
                  )}

                  {notes.length > 0 && (
                    <div className="research__side reveal">
                      {notes.map((note, i) => (
                        <Fragment key={i}>
                          {filled(note.heading) && <h3 className="h3" {...f(note, "heading")}>{note.heading}</h3>}
                          {filled(note.text) && <p {...f(note, "text")}>{note.text}</p>}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {filled(research.papersHeading) && <h3 className="h3 h3--rule reveal" {...f(research, "papersHeading")}>{research.papersHeading}</h3>}
              {papers.length > 0 && (
                <ol className="pubs reveal">
                  {papers.map((paper, i) => (
                    <li key={i}>
                      {filled(paper.year) && <span className="pubs__yr" {...f(paper, "year")}>{paper.year}</span>}
                      <span>
                        {filled(paper.title) && <a {...linkTo(paper.url)} {...f(paper, "title")}>{paper.title}</a>}
                        {filled(paper.title) && filled(paper.journal, paper.coauthors) && <br />}
                        {filled(paper.journal) && <i {...f(paper, "journal")}>{paper.journal}</i>}
                        {filled(paper.journal) && filled(paper.coauthors) && <>,{" "}</>}
                        <Bare field={field} object={paper} property="coauthors">{paper.coauthors}</Bare>
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {filled(research.booksHeading) && <h3 className="h3 h3--rule reveal" {...f(research, "booksHeading")}>{research.booksHeading}</h3>}
              {books.length > 0 && (
                <p className="reveal">
                  {books.map((book, i) => (
                    <Fragment key={i}>
                      {i > 0 && "; "}
                      {filled(book.title) && <i {...f(book, "title")}>{book.title}</i>}
                      {filled(book.publisher) && (
                        <>
                          {filled(book.title) ? " (" : "("}
                          <Bare field={field} object={book} property="publisher">{book.publisher}</Bare>)
                        </>
                      )}
                    </Fragment>
                  ))}.
                </p>
              )}
            </div>
          </section>
        )}

        {visible.institute && (
          <section id="institute" className="sec sec--deep wrap" {...labelled("h-institute", institute.heading)}>
            <Rail number={numbers.institute}>
              {filled(institute.heading) && <h2 id="h-institute" className="h2 reveal" {...f(institute, "heading")}>{institute.heading}</h2>}
            </Rail>
            <div className="body body--wide">
              {ledgers.map(({ ledger, rows }, i) => (
                <div className="ledger reveal" key={i}>
                  {filled(ledger?.heading) && <h3 className="ledger__head sc" {...f(ledger, "heading")}>{ledger?.heading}</h3>}
                  {rows.length > 0 && (
                    <dl>
                      {rows.map((row, j) => (
                        <div key={j}>
                          {filled(row.label) && <dt {...f(row, "label")}>{row.label}</dt>}
                          {filled(row.text) && <dd {...f(row, "text")}>{row.text}</dd>}
                          {(showSources || Boolean(row.keepSource)) && filled(row.sourceLabel) && <dd className="src"><a {...linkTo(row.sourceUrl)} {...f(row, "sourceLabel")}>{row.sourceLabel}</a></dd>}
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {visible.roles && (
          <section id="roles" className="sec wrap" {...labelled("h-roles", roles.heading)}>
            <Rail number={numbers.roles}>
              {filled(roles.heading) && <h2 id="h-roles" className="h2 reveal" {...f(roles, "heading")}>{roles.heading}</h2>}
            </Rail>
            <div className="body body--wide">
              {roleRows.length > 0 && (
                <div className="roles reveal">
                  <dl>
                    {roleRows.map((role, i) => (
                      <div key={i}>
                        {filled(role.label) && <dt {...f(role, "label")}>{role.label}</dt>}
                        {filled(role.text) && <dd {...f(role, "text")}><Inline text={role.text} /></dd>}
                      </div>
                    ))}
                  </dl>
                  <SourceLine section={roles} field={field} all={showSources} />
                </div>
              )}
            </div>
          </section>
        )}

        {visible.gallery && (
          <section id="gallery" className="sec sec--deep wrap gallery" {...labelled("h-gallery", gallery.heading)}>
            <Rail number={numbers.gallery}>
              {filled(gallery.heading) && <h2 id="h-gallery" className="h2 reveal" {...f(gallery, "heading")}>{gallery.heading}</h2>}
            </Rail>

            {photos.map((item, i) => {
              const { slot, sizes, target } = GALLERY_SLOTS[i];
              const credit = (showSources || Boolean(item.keepCredit)) && filled(item.credit);
              return (
                <figure className={`g g--${slot} reveal`} key={i}>
                  {filled(item.image) && (
                    <div className="frame">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        {...responsive(item.image, target)}
                        sizes={sizes}
                        loading="lazy"
                        decoding="async"
                        alt={item.alt ?? ""}
                        {...f(item, "image")}
                      />
                    </div>
                  )}
                  {(filled(item.caption) || credit) && (
                    <figcaption>
                      <Bare field={field} object={item} property="caption">{item.caption}</Bare>{" "}
                      {credit && <span className="credit" {...f(item, "credit")}>{item.credit}</span>}
                    </figcaption>
                  )}
                </figure>
              );
            })}
          </section>
        )}

        {visible.contact && (
          <section id="contact" className="sec wrap" {...labelled("h-contact", contact.heading)}>
            <Rail number={numbers.contact}>
              {filled(contact.heading) && <h2 id="h-contact" className="h2 reveal" {...f(contact, "heading")}>{contact.heading}</h2>}
            </Rail>
            <div className="body body--wide">
              {columns.length > 0 && (
                <div className="contact reveal">
                  {columns.map(({ column, rows }, i) => (
                    <div className="contact__col" key={i}>
                      {filled(column?.heading) && <h3 className="sc" {...f(column, "heading")}>{column?.heading}</h3>}
                      {rows.length > 0 && (
                        <ul>
                          {rows.map((row, j) => (
                            <li key={j}>
                              {filled(row.label) ? (
                                <span className="k" {...f(row, "label")}>{row.label}</span>
                              ) : (
                                <span className="k" aria-hidden="true" />
                              )}
                              {filled(row.value) && (row.href ? (
                                <a {...linkTo(row.href)} {...f(row, "value")}>{row.value}</a>
                              ) : (
                                <Bare field={field} object={row} property="value">{row.value}</Bare>
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                      {(showSources || Boolean(column?.keepSource)) && filled(column?.sourceLabel) && (
                        <p className="src">
                          <Bare field={field} object={contact} property="sourcePrefix">{contact.sourcePrefix}</Bare>{" "}
                          <a {...linkTo(column?.sourceUrl)} {...f(column, "sourceLabel")}>{column?.sourceLabel}</a>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {filled(contact.officialLabel) && (
                <p className="official reveal">
                  <a className="official__link" {...linkTo(contact.officialUrl)} {...f(contact, "officialLabel")}>{contact.officialLabel}</a>
                </p>
              )}
            </div>
          </section>
        )}
      </main>

      {(footerNotice || footerSources.length > 0) && (
        <footer className="foot" role="contentinfo">
          <div className="wrap foot__grid">
            {footerNotice && (
              <div className="foot__notice">
                {filled(footer.heading) && <h2 className="sc" {...f(footer, "heading")}>{footer.heading}</h2>}
                {filled(footer.linkLabel) && <p><a {...linkTo(footer.linkUrl)} {...f(footer, "linkLabel")}>{footer.linkLabel}</a></p>}
                {filled(footer.notice) && <p {...f(footer, "notice")}>{footer.notice}</p>}
                {filled(footer.updatedText) && (
                  <p className="foot__date">
                    <Bare field={field} object={footer} property="updatedLabel">{footer.updatedLabel}</Bare>{" "}
                    <time dateTime={footer.updatedDate ?? undefined} {...f(footer, "updatedText")}>{footer.updatedText}</time>
                  </p>
                )}
              </div>
            )}
            {footerSources.length > 0 && (
              <div className="foot__src">
                {filled(footer.sourcesHeading) && <h2 className="sc" {...f(footer, "sourcesHeading")}>{footer.sourcesHeading}</h2>}
                <ol>
                  {footerSources.map((source, i) => (
                    <li key={i}><a {...linkTo(source?.url)} {...f(source, "label")}>{source?.label}</a></li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </footer>
      )}
    </>
  );
}
