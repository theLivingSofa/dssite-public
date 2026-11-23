# Security

This site is a profile of a real public figure. A fake, defamatory or vandalised edit is the main threat, so the setup limits who can edit, blocks dangerous content automatically, and alerts the owner to every change.

No setup is unhackable. [Residual risks](#residual-risks) lists what can still go wrong.

## How a change goes live

```text
Editor at /admin  →  AI proofreader suggests fixes  →  saved to `edits`  →  automatic checks
                                                                                │
Live site  ←  Cloudflare deploys  ←  `production`  ←  published automatically if they pass
```

There is no human review before publishing. The owner gets an email for every published change. The AI proofreader only suggests fixes and has no power to save or publish.

## Threat model

| Who | What they would try | What stops them |
|---|---|---|
| Random vandal | Open `/admin` and edit | The login page is public, but TinaCloud rejects any save without an invited login |
| Random vandal | Push to GitHub or open a pull request | No write access. Only saves on `edits` publish automatically |
| Random vandal | Run up the AI quota | The proofreader only answers people logged in to this TinaCloud project |
| Anyone | Trick the AI with text inside an edit | The AI cannot save or publish. Its suggestions are filtered, and an editor must accept them |
| Random vandal | Find a leaked key | No secrets in the repo or browser files. The only build token is read-only |
| Someone who steals an editor's login | Publish fake content | **Not prevented.** The Tina login is the only gate. The owner is emailed about the change and can roll it back |
| Someone who steals an editor's login | Inject scripts or hidden links | Text is escaped, unsafe links are removed, and the content gate fails the check |
| Someone who steals an editor's login | Upload a disguised file | Only real JPG, PNG and WebP files under 8 MB, and real WOFF2, TTF and OTF fonts under 2 MB in the fonts folder, pass |
| Malicious collaborator | Quietly change code from the edit branch | The check fails if `edits` touches anything except content and photos |
| Someone who steals the owner's GitHub | Disable protection and publish | **Not fully preventable.** 2FA reduces the risk, and the daily check and change log help detect it |
| Someone who steals the owner's Cloudflare | Change what is deployed | **Not fully preventable.** 2FA reduces the risk, and the daily check helps detect it |

## Controls

### 1. Who can edit

- **TinaCloud:** only invited collaborators can save. There is no public or anonymous editing.
- **No Cloudflare Access:** its $0 plan requires a card and permission to charge for usage above the free limits, which breaks this project's domain-only budget. `/admin` and `/edit` load publicly, but they show no way to save without a Tina login.
- **Search engines:** `/admin` and `/edit` send `noindex` headers, are disallowed in `robots.txt`, and are not linked from the site.
- **2FA:** required on GitHub, Cloudflare and the email inboxes used for logins. Every Tina account needs a strong, unique password.

**Invite an editor:** TinaCloud project > **Collaborators** > invite their email as **Editor**. The free plan allows 2 users. Never share your own login: it is tied to your GitHub account, which controls everything.

**Remove an editor:** remove them from TinaCloud **Collaborators**.

### 2. Automatic checks before anything goes live

- `edits` is where TinaCMS saves. It is the GitHub default branch because Tina writes uploaded photos to the default branch and cannot commit them to a protected one.
- `production` is what Cloudflare deploys. It only accepts pull requests that pass the content check. Direct pushes, force pushes and deletion are blocked, and the rules apply to admins.
- A save that passes is merged automatically. A save that fails stays off the live site and the owner is emailed.
- Cloudflare preview builds are off, because making them private needs Cloudflare Access. A save that fails the checks gets no public link on the site's hosting, though it remains visible in this public GitHub repo.

**To turn human approval back on:** in GitHub, open **Settings > Branches**, edit the `production` rule, and require 1 approval. Then remove the "Publish a save" step from `.github/workflows/review.yml`.

### AI proofreader

- On Save, only the changed text is sent to `/api/proofread`, a Cloudflare Function that asks TinaCloud whether the user is logged in to this project.
- It uses Gemini (`gemini-flash-lite-latest`) on Google's free tier, then Cloudflare Workers AI's free allowance if Gemini fails. If both fail, the save continues unchecked.
- Suggestions that would change a name, number, negation or meaning are dropped. Nothing is changed unless the editor accepts it.
- **To keep it free:** create the Gemini key in a project with no billing account, and stay on the Workers Free plan. At a free limit, requests stop instead of being charged.

### 3. Secrets

- The repo and browser files contain no secrets. `.env` files are ignored by Git.
- `NEXT_PUBLIC_TINA_CLIENT_ID` is a public identifier.
- `TINA_TOKEN` is a **read-only** content token, stored as a Cloudflare secret and used only during the build. It does not appear in the deployed files.
- `GEMINI_API_KEY` is a Cloudflare secret used only by the server-side function. It never reaches the browser.
- No Cloudflare API token exists, because the Git integration deploys without one. That is safer than a scoped token.
- GitHub secret scanning, push protection and Dependabot alerts are on.

### 4. Content safety

- All fields are plain typed text with length limits. There is no raw HTML, MDX or rich-text field.
- `scripts/validate-content.mjs` enforces the rules on every build and every change to `edits`. It rejects HTML, unsafe links, unknown fields, hidden characters, wrong file types and missing sources.
- Every timeline entry, milestone, role and publication needs an https source.
- External links use `rel="noopener noreferrer"`.
- A strict Content-Security-Policy and standard security headers are set in `public/_headers`.
- The independent-profile notice is fixed in code and cannot be edited in the CMS.

### 5. Detection

- Every change to `production` posts to the **Production change log** issue, which emails the owner.
- A daily workflow compares the live site with `production` and emails the owner through the **Live site alert** issue if they differ.

---

## Rollback: fix a bad publish in under 5 minutes

**Step 1: put the good version back (about 1 minute).**

1. Open Cloudflare > **Workers & Pages** > this project > **Deployments**.
2. Find the last good production deployment.
3. Open its **⋯** menu and choose **Rollback to this deployment**.

The live site is now safe. The bad content is still in Git, so the next publish would bring it back unless you do step 2.

**Step 2: remove it from `production`.**

Find the merge commit under **Commits** on `production`, then run:

```bash
git fetch origin
```

```bash
git switch -c code/rollback origin/production
```

```bash
git revert -m 1 MERGE_COMMIT_ID
```

```bash
git push -u origin code/rollback
```

A bot opens a pull request. Merge it. Use a new branch name each time.

**Step 3: clean `edits`.** The merge copies the fix into `edits` automatically. Check `/admin` shows the correct content.

## If an account is compromised

**An editor's account**

1. Remove them from TinaCloud **Collaborators**.
2. Close any open pull request you don't recognise.
3. Check the **Commits** on `edits`, and revert anything bad.

**Your GitHub account**

1. Change the password and reset 2FA from a clean device.
2. Go to **Settings > Sessions** and sign out other sessions.
3. Review **Settings > Applications** and **Developer settings**, and revoke anything unknown.
4. Confirm the `production` protection rule is still on.
5. Review **Commits** and the repository's collaborators.
6. Roll back the site if needed.

**Your Cloudflare account**

1. Change the password and reset 2FA.
2. Review members, API tokens, the build settings and environment variables.
3. Redeploy the last good `production` commit.
4. Rotate the Tina token.

**Your email inbox**

Secure it first. It receives password resets for everything else.

## Rotating keys

| Key | Where | How to rotate |
|---|---|---|
| `TINA_TOKEN` | TinaCloud **Tokens**, Cloudflare secret | Create a new read-only token, update the Cloudflare secret, redeploy, delete the old token |
| `GEMINI_API_KEY` | Google AI Studio, Cloudflare secret | Create a new key, update the Cloudflare secret, redeploy, delete the old key |
| `NEXT_PUBLIC_TINA_CLIENT_ID` | TinaCloud **Overview** | Public, so no rotation needed |
| GitHub sign-in on this computer | GitHub **Settings > Applications** | Revoke, then sign in again |

---

## Things only Ayush can do

Do these in order. Each one needs your own login.

**1. Turn on 2FA**

- [ ] **Email inbox:** turn on 2-step verification. Do this first.
- [ ] **GitHub:** Settings > Password and authentication > Enable two-factor authentication.
- [ ] **Cloudflare:** My Profile > Authentication > Two-Factor Authentication.
- [ ] **TinaCloud:** sign in with GitHub so it is covered by your GitHub 2FA.

**2. Connect TinaCloud**

- [ ] At [app.tina.io](https://app.tina.io), create a project from `theLivingSofa/dssite-public`.
- [ ] Copy the **Client ID**, and create a **read-only** token.
- [ ] Leave Git co-authoring **off**. It would publish editors' email addresses in this public repo.

**3. Connect Cloudflare Pages**

- [ ] **Workers & Pages > Create application > Pages > Connect to Git**, and pick `dssite-public`.
- [ ] Production branch: `production`. Build command: `npm run build`. Output directory: `out`.
- [ ] Add `NEXT_PUBLIC_TINA_CLIENT_ID`, and add `TINA_TOKEN` as a **Secret**.
- [ ] Under **Settings > Build > Branch control**, set preview branches to **None**.
- [ ] Add your `pages.dev` address to **Site URLs** in TinaCloud.

**4. Turn on the free proofreader**

- [ ] At [aistudio.google.com/apikey](https://aistudio.google.com/apikey), create a key. **Don't add billing or a card.**
- [ ] In the Pages project, add `GEMINI_API_KEY` as a **Secret**.
- [ ] Under **Settings > Bindings > Add > Workers AI**, name the binding `AI`. This is the free backup.
- [ ] Redeploy.

**5. Turn on your alerts**

- [ ] GitHub **Settings > Notifications**: turn on email for **Participating, @mentions and custom**.
- [ ] Open this repo and set **Watch** to **Participating and @mentions**.

**6. Hand over**

- [ ] Invite the new editor in TinaCloud as **Editor**, using their own email and a strong, unique password.
- [ ] Send them [EDITOR-GUIDE.md](EDITOR-GUIDE.md).
- [ ] Turn on **auto-renew** for the domain, with a payment method that will not expire soon.
- [ ] Remove the old Netlify site once this one is live.

**After that:** you only need to act if an email says a save failed, the live site check failed, or a change looks wrong.

---

## Residual risks

- **Your GitHub account is the master key.** Whoever controls it can turn off every protection. 2FA is the most important step on this page.
- **The Tina login is the only gate to editing.** There is no second login, so a stolen Tina password or email inbox could publish a change.
- **Cloudflare can bypass Git.** Someone in your Cloudflare account can change what is deployed. Cloudflare's GitHub app also has administration write access to this repo, so a compromised Cloudflare account or app could change repo settings.
- **Nobody reviews a change before it is public.** The checks and the AI catch dangerous content and typos, not false content. A stolen editor login could publish a false claim until someone notices. A source link proves that a link exists, not that it supports the claim.
- **The daily check compares the site with `production`.** It catches tampering with the deployed site, but not a bad edit that was published normally. The change email covers that.
- **The proofreader can be wrong or unavailable.** Free models and limits can change. Text sent on Google's free tier may be used to improve its products, so never put private information in a draft.
- **All edits are publicly visible on GitHub.** This repo is public, so every save and its history can be read there.
- **Git history is permanent.** Once something is in this public repo, assume it has been copied, even after removal.
- **The photos belong to IIM Rohtak.** They are published here with credit, and no licence is stated on the institute's site.
- **The editor has a looser policy than the public page.** `/admin` needs inline scripts to work, so it relies on Tina's login.
- **One dependency advisory is open.** Zod, used inside Tina's editor tools, has a memory-exhaustion issue with no fix compatible with Tina yet. It does not ship on the public page.
- **The daily check is not instant.** A problem could be live for up to a day. GitHub pauses scheduled workflows after 60 days without repository activity. The check tries to keep itself switched on, but if the runs stop, re-enable it under **Actions**.
- **Uploaded fonts are checked for structure, not scanned for malware.** Browsers run their own safety check on web fonts. Anything uploaded is public and stays in Git history, so only upload fonts you have the right to use.
- **The domain must be renewed.** If it lapses, the site goes offline and someone else could buy the address.
- **Third parties can change.** GitHub, TinaCloud or Cloudflare can have outages, security incidents, or new plan limits.
