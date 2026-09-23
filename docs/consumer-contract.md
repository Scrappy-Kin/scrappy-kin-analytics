# Analytics consumer contract

This is the approved target for `.com`, Blog, and Chess, **not yet a description
of live production**. The sites and private deployment must migrate together.

## Promise and choice

- We measure consented online page loads to learn whether our work is used,
  not who uses it. We do not estimate unique visitors or count in-page activity.
- No choice, Decline, dismissal, unavailable storage, Global Privacy Control,
  or Do Not Track means no event. Accept and Decline have equal visual weight.
- Each site has a prominent first-use panel and a visible, keyboard-operable
  **Privacy choices** footer control that reopens that same panel. Chess may
  also link to it from Settings. Choices are local to each site's origin.
- A later decline stops future collection. We cannot find or subtract one
  person's contribution from aggregate counts because no identity is retained.

[`app/client.js`](../app/client.js) owns the exact shared copy, consent state,
and event gate. Render `copy(siteName)` as text, keeping the two short bullet
sections and the explanation of why measurement helps. Sites own visual style
and accessibility, not separate wording or a second storage key. Do not infer
consent from closing the panel. A first-load Accept counts at most once.

## Data and ownership

- The only browser event field is the public page path. The collector rejects
  privacy/admin paths, strips query strings and fragments, and retains daily
  page-load totals, bounded normalized-path counts, and ignored-automation
  counts. It transiently checks the browser description for known bots. It
  does not read network addresses for analytics or create visitor identifiers.
- No referrers, accounts, cookies, location, browser/device category, full URL,
  cross-site history, Chess gameplay events, or raw event archive.
- This repository owns copy/state, browser client, collector, data lifecycle,
  and tests. Each site owns script inclusion, panel presentation, footer
  control, and Privacy Policy/Terms links. Private infrastructure owns allowed
  sites, routing, storage, reporting, backups, and deployment authority.
- Adding a consumer, event, or dimension requires founder-approved scope.

## Verification and migration

Tests must establish: no event before acceptance or after decline; automatic
privacy signals and storage failure suppress events; first-load acceptance
counts once; legacy exclusions remain off; no unapproved field enters storage;
and legacy salts, visitor tokens, unique-visitor totals, and referrers are
removed from active storage and exports.

The VPS custodian must separately inspect proxy/access logs, historical
backups, cached old clients, reporting, and the release cutover. Public source
and release receipts improve inspectability and traceability; neither alone
proves what production runs. Do not claim that Scrappy Kin as a whole has no
way to distinguish visitors without checking the surrounding systems.
