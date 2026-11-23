# Security

This site is a profile of a real public figure. A fake, defamatory or vandalised edit is the main threat, so the setup assumes an edit can be malicious until a person has approved it.

No setup is unhackable. [Residual risks](#residual-risks) lists what can still go wrong.

## How a change goes live

```text
Editor at /admin  →  saved to `edits`  →  checks run  →  bot opens a pull request
                                                               │
Live site  ←  Cloudflare deploys  ←  `production`  ←  owner approves and merges
```

Nothing reaches the live site until the owner approves a pull request on GitHub.

## Threat model

| Who | What they would try | What stops them |
|---|---|---|
| Random vandal | Open `/admin` and edit | Cloudflare Access email PIN, then TinaCloud login. Only invited people can save |
| Random vandal | Push to GitHub or open a pull request | No write access. `production` needs the owner's approval |
| Random vandal | Find a leaked key | No secrets in the repo or browser files. The only build token is read-only |
| Someone who steals an editor's login | Publish fake content | Their edit stops at `edits`. The owner sees it in a pull request and can reject it |
| Someone who steals an editor's login | Inject scripts or hidden links | Text is escaped, unsafe links are removed, and the content gate fails the check |
| Someone who steals an editor's login | Upload a disguised file | Only real JPG, PNG and WebP files under 8 MB pass |
| Malicious collaborator | Quietly change code from the edit branch | The check fails if `edits` touches anything except content and photos |
| Malicious collaborator | Change content after it was approved | A new commit dismisses the approval |
| Someone who steals the owner's GitHub | Disable protection and publish | **Not fully preventable.** 2FA reduces the risk, and the daily check and change log help detect it |
| Someone who steals the owner's Cloudflare | Change what is deployed | **Not fully preventable.** 2FA reduces the risk, and the daily check helps detect it |

## Controls

### 1. Who can edit

- **TinaCloud:** only invited collaborators can save. There is no public or anonymous editing.
- **Cloudflare Access:** an email one-time PIN is required before `/admin` or `/edit` will load.
- **Search engines:** `/admin` and `/edit` send `noindex` headers, are disallowed in `robots.txt`, and are not linked from the site.
- **2FA:** required on GitHub, Cloudflare and the email inbox that receives the PIN.

**Invite an editor:** TinaCloud project > **Collaborators** > invite their email as **Editor**. Then add the same email to the Access policy in Cloudflare. The free plan allows 2 users.

**Remove an editor:** remove them from TinaCloud **Collaborators** and from the Access policy, then in Zero Trust revoke their active session.

### 2. Approval before anything goes live

- `edits` is where TinaCMS saves. It is the GitHub default branch because Tina writes uploaded photos to the default branch and cannot commit them to a protected one.
- `production` is what Cloudflare deploys. It requires a pull request, an approval from the code owner, and a passing check. Direct pushes, force pushes and deletion are blocked, and the rules apply to admins.
- A bot opens the pull request because GitHub does not let authors approve their own. The bot cannot approve in the owner's place, because only a code owner's approval counts.
- Cloudflare preview links are private through the Pages access policy. That policy does **not** cover the main address, which is why `/admin` has its own Access application.

### 3. Secrets

- The repo and browser files contain no secrets. `.env` files are ignored by Git.
- `NEXT_PUBLIC_TINA_CLIENT_ID` is a public identifier.
- `TINA_TOKEN` is a **read-only** content token, stored as a Cloudflare secret and used only during the build. It does not appear in the deployed files.
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

A bot opens a pull request. Approve and merge it. Use a new branch name each time.

**Step 3: clean `edits`.** The merge copies the fix into `edits` automatically. Check `/admin` shows the correct content.

## If an account is compromised

**An editor's account**

1. Remove them from TinaCloud **Collaborators** and the Access policy.
2. Revoke their Access session in Zero Trust.
3. Close any open pull request you don't recognise.
4. Check the **Commits** on `edits`, and revert anything bad.

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

Secure it first. It receives Access PINs and password resets for everything else.

## Rotating keys

| Key | Where | How to rotate |
|---|---|---|
| `TINA_TOKEN` | TinaCloud **Tokens**, Cloudflare secret | Create a new read-only token, update the Cloudflare secret, redeploy, delete the old token |
| `NEXT_PUBLIC_TINA_CLIENT_ID` | TinaCloud **Overview** | Public, so no rotation needed |
| GitHub sign-in on this computer | GitHub **Settings > Applications** | Revoke, then sign in again |
| Access sessions | Zero Trust | Revoke the user's sessions |

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
- [ ] Under **Settings > Build > Branch control**, set preview branches to **Custom** and include only `edits`.
- [ ] Add your `pages.dev` address to **Site URLs** in TinaCloud.

**4. Lock the doors**

- [ ] **Settings > General > Enable access policy** on the Pages project. This makes preview links private.
- [ ] In **Zero Trust**, choose the **Free** plan. Cloudflare may ask for a card even though the plan is $0. Stay under 50 users.
- [ ] **Integrations > Identity providers > Add > One-time PIN.**
- [ ] **Access > Applications > Add > Self-hosted.** Add your `pages.dev` address twice, with the paths `admin` and `edit`. Allow only your email, using One-time PIN.
- [ ] When you connect a custom domain, add the same two paths for it.

**5. Turn on your alerts**

- [ ] GitHub **Settings > Notifications**: turn on email for **Participating, @mentions and custom**.
- [ ] Open this repo and set **Watch** to **Participating and @mentions**.

**6. Your routine**

- [ ] Review each pull request's **Files changed** before approving.
- [ ] Reject anything you don't recognise.
- [ ] Remove the old Netlify site once this one is live.

---

## Residual risks

- **Your GitHub account is the master key.** Whoever controls it can turn off every protection. 2FA is the most important step on this page.
- **Your email inbox can open the first gate.** Access PINs go there. An attacker would still need a Tina login to save.
- **Cloudflare can bypass Git.** Someone in your Cloudflare account can change what is deployed.
- **You can approve a bad edit.** The gate relies on you reading the change. A source link proves that a link exists, not that it supports the claim.
- **Unapproved edits are publicly visible on GitHub.** This repo is public, so anything saved to `edits` can be read there before approval, although it is not on the site.
- **Uploaded photos can be public before approval.** They are stored on Tina's media service and the `edits` branch.
- **Git history is permanent.** Once something is in this public repo, assume it has been copied, even after removal.
- **The photos belong to IIM Rohtak.** They are published here with credit, and no licence is stated on the institute's site.
- **The editor has a looser policy than the public page.** `/admin` needs inline scripts to work, so it relies on Access and Tina's login.
- **One dependency advisory is open.** Zod, used inside Tina's editor tools, has a memory-exhaustion issue with no fix compatible with Tina yet. It does not ship on the public page.
- **The daily check is not instant.** A problem could be live for up to a day. GitHub also pauses scheduled workflows after 60 days without repository activity, so re-enable it if that happens.
- **Third parties can change.** GitHub, TinaCloud or Cloudflare can have outages, security incidents, or new plan limits.
