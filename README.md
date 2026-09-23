# Scrappy Kin Analytics

Public source for the privacy-minimal, first-party audience measurement used by
[scrappykin.com](https://scrappykin.com) and the Scrappy Kin blog.

This repository owns the browser client and collector implementation that runs
in production. Private infrastructure owns routing, deployment authority,
daily secret values, live storage, reporting, and backups. A pinned
commit from this repository is imported for each production release; the
private snapshot is not a second editable implementation.

## Data flow

The generated browser client sends only the public page path. It sends nothing
when Global Privacy Control, Do Not Track, or the browser-local exclusion
preference is active, and it excludes privacy and administration routes.

The collector briefly receives the network address and browser description
needed to answer the request. It combines those values in memory with the site
name and a random daily secret to estimate anonymous visitors during one UTC
day. Raw request identity is not written to analytics storage.

Current-day storage contains aggregate views, normalized public paths,
ignored-automation counts, and unlinkable daily visitor tokens. At day close,
the secret and visitor tokens are destroyed and replaced by one anonymous daily
visitor total. Only finalized aggregates are eligible for backup.

The implementation does not collect referring domains, geography, browser or
device categories, account identity, cookies, query strings, full URLs,
cross-site history, or a raw event archive.

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

## Deferred Chess source-attribution gate

Referrer collection is currently off for every consumer. Do not build or enable
a Chess source taxonomy, low-volume suppression, or related reporting until
consented Chess measurement records at least 10 anonymous daily visitors in one
UTC day. Reaching that threshold opens a new review; it does not authorize
source collection or create a Chess-specific exception to the shared policy.

If source attribution is later approved, retain a coarse source category only
when at least 10 consenting anonymous visitors are attributed to that category
in the same UTC day. Before final storage, discard category-specific counts
below the threshold while preserving the overall daily load and visitor totals.
Never accumulate suppressed categories across days to make them reportable.

## Test

Run the focused privacy-invariant suite with Node.js 20 or later:

```bash
node test.js
```

## License

Licensed under the GNU Affero General Public License v3.0; see
[`LICENSE`](LICENSE).
