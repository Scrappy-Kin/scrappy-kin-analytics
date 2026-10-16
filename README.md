# Scrappy Kin Analytics

Public source for consent-first, first-party page-visit measurement for
[scrappykin.com](https://scrappykin.com), the Blog, and Chess. Consult the
private deployment receipt to identify the live source revision.

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

The browser sends only the public page path and a non-retained consent-protocol
version after acceptance. The collector rejects unversioned legacy requests,
including cached send-by-default clients. The collector
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
node --test test-storage.js test-http.js
```

These use temporary synthetic storage and loopback HTTP. They verify consent,
batching, write recovery, rollover, restart, shutdown, and request bounds; they
are not pressure tests or a production capacity claim.

## Collector operation

The collector loads today's aggregates once and increments bounded counters in
memory. One asynchronous flush every 60 seconds replaces each changed site's
JSON file through a temporary file and rename. Slow flushes coalesce; there is
no queue or archive of individual events. New arrivals during a snapshot remain
dirty for the next flush. Failed writes keep the full aggregate for retry,
without replaying increments. `/health` returns 503 after a failed flush until
a flush succeeds; `/script.js` can still be served.

A 204 for a valid event means accepted into memory, **not persisted to disk**.
A sudden process crash normally loses up to about a minute of recent counts;
stalled or failed storage can extend that window. Live disk reports lag for
the same reason. Atomic replacement avoids partial target JSON; there is no
`fsync` or power-failure durability promise. This tradeoff is intentional for
approximate page counts.

Startup scrubs legacy fields from all daily files, including today, removes
legacy salts, and finalizes earlier days. The periodic flush or first event
after UTC midnight flushes and finalizes the prior day before loading the new
one. New-day requests wait for that transition within the admission limit;
failed rollover returns 503 until it can recover. A backward UTC day change
rejects recording rather than mixing days. Memory holds only the configured
sites' active day, at most 500 public paths plus an `other` counter per site.

Request bounds are 2,048 body bytes, 64 admitted event requests (including body
readers and rollover waiters), 128 connections, and 8 KiB of headers. Body and
header deadlines are 5 seconds; request/socket deadlines are 10 seconds and
idle keep-alive is 5 seconds. Oversized bodies stop buffering and close with
413; timed-out bodies close with 408; excess admitted work receives 503.
These are protective defaults, not measured throughput limits. The proxy must
enforce compatible limits and preserve the existing no-access-log boundary.

SIGTERM/SIGINT stop admission, drain existing requests, and flush before exit.
Shutdown is capped at 15 seconds and exits unsuccessfully if persistence fails
or the deadline expires. Deployment must allow more than 15 seconds of grace.

**Exactly one collector owns writes to the data directory.** Do not run
multiple replicas against it. Startup cleanup and daily finalization belong
to the collector; no standalone finalization command is shipped. Read-only
reporting/export can continue. Before deploying this revision, the infrastructure owner must check
external writers/finalizer schedules, shutdown grace, resource isolation and
proxy limits. The batching change requires no browser client or consent-copy
change.

## License

Licensed under the GNU Affero General Public License v3.0; see
[`LICENSE`](LICENSE).
