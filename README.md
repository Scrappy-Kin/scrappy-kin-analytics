# Scrappy Kin Analytics

Public source for the privacy-minimal, first-party audience measurement used by
[scrappykin.com](https://scrappykin.com) and the Scrappy Kin blog.

This repository owns the browser client and collector implementation that runs
in production. Private infrastructure owns routing, deployment authority,
daily secret values, live storage, reporting, and backups. A pinned
commit from this repository is imported for each production release; the
private snapshot is not a second editable implementation.

## Data flow

The generated browser client sends only the public page path and a broad
referring hostname. It sends nothing when Global Privacy Control, Do Not Track,
or the browser-local exclusion preference is active, and it excludes privacy
and administration routes.

The collector briefly receives the network address and browser description
needed to answer the request. It combines those values in memory with the site
name and a random daily secret to estimate anonymous visitors during one UTC
day. Raw request identity is not written to analytics storage.

Current-day storage contains aggregate views, normalized public paths, broad
referring domains, ignored-automation counts, and unlinkable daily visitor
tokens. At day close, the secret and visitor tokens are destroyed and replaced
by one anonymous daily visitor total. Only finalized aggregates are eligible
for backup.

The implementation does not collect geography, browser or device categories,
account identity, cookies, query strings, full URLs, cross-site history, or a
raw event archive.

## Trust limits

Public source makes the claimed behavior inspectable; it does not prove which
commit a particular server runs or that surrounding proxies, logs, backups,
and deployment controls preserve the same boundary. Production receipts and
infrastructure inspection improve operational traceability; neither
independently proves what a running service does.

The collector accepts events only for infrastructure-configured site
namespaces. Adding a consumer is a privacy and deployment decision, not merely
a client-side integration.

## Test

Run the focused privacy-invariant suite with Node.js 20 or later:

```bash
node test.js
```

## License

Licensed under the GNU Affero General Public License v3.0; see
[`LICENSE`](LICENSE).
