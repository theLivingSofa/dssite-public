# Prof. Dheeraj Sharma: profile site

A one-page profile you can edit from the browser, without touching code.

- **Editor:** [TinaCMS](https://tina.io) with the free TinaCloud plan (2 editors).
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com) free plan.
- **Site:** Next.js, exported to static files. Visitors get plain HTML, CSS and one small script.
- **You pay for:** the domain name only.

## How editing works

1. Open `https://your-site/admin` and log in.
2. Click anything on the page. Its field opens in the left sidebar.
3. Type. The preview changes as you type.
4. Press **Save draft**. A free AI proofreader points out likely spelling or grammar mistakes. Choose **Fix it and save**, **Edit and save** or **Save anyway**.
5. Press **Publish** to send all changed sections live in one deployment. Drafts stay in the browser until then.

Automatic checks run, and the changes go live about five minutes later. If a save fails the checks, the live site stays as it was and the owner gets an email. Every change is kept in GitHub history, and [SECURITY.md](SECURITY.md) explains how to roll back.

---

## First-time setup

The owner keeps a private setup checklist for GitHub, TinaCloud and Cloudflare Pages.

### Connecting a custom domain

In Cloudflare, open your Pages project, then **Custom domains > Set up a domain**, and enter your domain. Add it here **before** changing any DNS.

**For a main domain (`example.com`):** the domain has to use Cloudflare's nameservers.

1. Follow Cloudflare's prompt to add the domain to your account (the Free plan is enough).
2. Go to where you bought the domain and replace its nameservers with the two Cloudflare shows you.
3. Wait for it to activate. This can take from a few minutes to a day.

**For a subdomain (`profile.example.com`):** add one record at your current DNS provider:

| Type | Name | Target |
|---|---|---|
| CNAME | `profile` | `your-project.pages.dev` |

**After the domain works:**

1. Add `https://your-domain` to **Site URLs** in TinaCloud.
2. In `/admin`, change **Website address** under **11 Site settings and sharing** to `https://your-domain/`.
3. Update the `LIVE_URL` repository variable so the daily check follows the new address.

---

## Editing guide

| To change | Do this |
|---|---|
| Any text | Click it on the page, type, Save |
| A photo | Click the photo, click its thumbnail in the sidebar, pick or **Upload** an image, then **Insert** and Save |
| Italics | Put stars around words: `*Journal of Marketing Channels*` |
| A link's address | Click the link, then edit **Link address** in the sidebar |
| Add, remove or reorder items | Use the list in the sidebar (timeline, papers, roles and so on) |
| Tab title, search text, sharing card | **11 Site settings and sharing** |
| A font | Click the text, choose a **Font** under its box, then **Just this text** or the **All...** button |

Photos must be JPG, PNG or WebP, under 8 MB. They are resized and given the site's print tone automatically during the rebuild. Until then, the editor preview shows the photo as uploaded. The gallery layout holds seven photos.

**These are edited in the sidebar, because they have nothing visible to click:** photo descriptions (alt text), link addresses, machine-readable dates, and everything in **Site settings and sharing**.

**To undo something already live:** follow the rollback steps in [SECURITY.md](SECURITY.md).

## Free-plan limits

- Cloudflare Pages: 500 builds a month, so about 500 saves. Group small edits into one save when you can.
- TinaCloud: 2 editors and 100 GB of bandwidth a month.

## Troubleshooting

- **`/admin` says the URL is not allowed:** add that exact address to **Site URLs** in TinaCloud.
- **Build fails with a TinaCloud error:** check both environment variables in Cloudflare, then retry the deployment.
- **Saved, but the site hasn't changed:** the save may have failed the checks. Open the repository's **Pull requests**, then check the latest build under **Deployments** in Cloudflare.
- **A check failed:** open **Details** on the check. It names the field to fix.
- **WhatsApp shows an old preview:** it caches links. Share the link with `?v=2` on the end.

## For developers

```bash
npm install
```

```bash
npm run dev
```

The site runs at http://localhost:3000 and the editor at http://localhost:3000/admin/index.html. Local edits write straight to `content/site/`, with no accounts needed.

| Path | What it is |
|---|---|
| `content/site/*.json` | All page content, one file per section |
| `tina/` | The editor's schema and config |
| `components/Site.tsx` | The page markup, shared by the public page and the editor preview |
| `app/page.tsx` | Public page. `scripts/finish-export.mjs` strips React from it after the build |
| `app/edit/` | The preview shown inside `/admin` (not indexed by search engines) |
| `public/css/main.css` | All styles, including the scroll-driven animations |
| `public/js/main.js` | Word-by-word text effect, nav and fallback reveal |
| `scripts/images.mjs` | Sizes and tones uploaded photos at build time |
| `lib/content-rules.mjs` | Content rules and the fixed footer notice |
| `scripts/validate-content.mjs` | The content gate |
| `scripts/check-live.mjs` | Daily live-site check |
| `functions/api/proofread.js` | Free AI proofreader, server side |
| `tina/proofread.ts` | The proofreading message in the editor |
| `public/_headers` | Security headers |

Only the build output reaches the live site. The build stops with an error if a Markdown, Python or `.env` file ends up in it.
