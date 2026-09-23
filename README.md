# Scrappy Kin Analytics

Public source for consent-first, first-party page-visit measurement for
[scrappykin.com](https://scrappykin.com), the Blog, and Chess. The new consent
contract is approved but **not yet a claim about live production**; the three
sites and private deployment must migrate together.

This repository owns the browser client and collector implementation that runs
in production. Private infrastructure owns routing, deployment authority,
live storage, reporting, and backups. A pinned
commit from this repository is imported for each production release; the
private snapshot is not a second editable implementation.

## Data flow

[`app/client.js`](app/client.js) is the exact browser client served at
`/_analytics/script.js`. It owns the shared consent state, copy, and event
gate. Sites supply their name and presentation, but must use its choice API and
copy rather than forking the promise. Unset, declined, unavailable storage,
Global Privacy Control, and Do Not Track all send nothing. Privacy and
administration routes are excluded. Legacy browser exclusions remain declined.

The browser sends only the public page path after acceptance. The collector
increments a daily page-load total and normalized public-path count. It uses
the browser description transiently to omit known automation, but creates no
visitor token or unique-visitor estimate and does not read network addresses
for analytics. The web server and proxy still handle network requests; inspect
their logging configuration before making claims about the whole operation.

Storage contains daily views, normalized public paths, and ignored-automation
counts. Finalized aggregates are eligible for export and backup. Startup and
finalization remove legacy visitor tokens, unique-visitor totals, referrers,
and salt files from active storage; the VPS custodian must handle historic
backups and release cutover separately.

The implementation does not retain referring domains, geography, browser or
device categories, account identity, cookies, query strings, full URLs,
cross-site history, or a raw event archive. Counts describe consented online
page loads, not people, readership, or offline Chess launches.

The shared consumer contract is documented in
[`docs/consumer-contract.md`](docs/consumer-contract.md).

## Trust limits

Public source makes the claimed behavior inspectable; it does not prove which
commit a particular server runs or that surrounding proxies, logs, backups,
and deployment controls preserve the same boundary. Production receipts and
infrastructure inspection improve operational traceability; neither
independently proves what a running service does.

The collector accepts events only for infrastructure-configured site
namespaces. Adding a consumer is a privacy and deployment decision, not merely
a client-side integration.

## Deferred source attribution

Referrer collection is off for every consumer. The old unique-visitor gate is
inapplicable now that visitor estimation is gone. Any future source categories
need a concrete use and fresh, company-wide privacy review; this repository
does not authorize them.

## Test

Run the focused privacy-invariant suite with Node.js 20 or later:

```bash
node test.js
```

## License

Licensed under the GNU Affero General Public License v3.0; see
[`LICENSE`](LICENSE).
