# Analytics consumer contract

This is the approved target contract for products that use Scrappy Kin's
first-party measurement. A product is not eligible merely because the collector
can technically accept its events. Existing publication consumers predate the
explicit-choice requirement and must be migrated before they satisfy this
contract; the document does not claim that migration is already live.

## Ethical boundaries

- Measurement exists to understand whether Scrappy Kin's work is being used,
  not who is using it.
- Collection begins only after an explicit local choice. Dismissal, uncertainty,
  or failure leaves collection off.
- Accepting and declining must be equally available. The interface must not
  visually or verbally steer people toward acceptance.
- Global Privacy Control and Do Not Track remain automatic exclusions.
- A later decline stops future collection. Finalized anonymous aggregates cannot
  be located or removed for one person because no identity is retained.

## Disclosure and choice design

The first-use choice must state, in plain language and without requiring a
scroll:

1. the exact signals retained;
2. why Scrappy Kin wants them;
3. how same-day anonymous visitor estimation works;
4. the important things that are not collected; and
5. that declining turns measurement off.

Do not summarize this as "anonymous tracking." Products must also provide a
durable settings surface where the current choice can be inspected or changed.

## Implementation rules

- Each product owns its script inclusion, first-use choice, durable control, and
  links to Scrappy Kin's Privacy Policy and Terms.
- This repository owns the browser client, collector, data lifecycle, shared
  contract, and invariant tests.
- Private infrastructure owns allowed-site configuration, routing, storage,
  backups, reporting, deployment authority, and pinned production snapshots.
- A newly allowed site must fail closed until its approved policy is present.
- Site namespaces and daily visitor key material must remain isolated even when
  consumers share one implementation.
- Client and collector boundaries must both reject fields outside the approved
  policy.

## Currently collected data

The publication configuration retains daily views, anonymous daily visitor
totals, normalized public page paths, and ignored-automation counts. During the
current UTC day it temporarily retains unlinkable daily visitor tokens.

Referring domains are not collected or retained. The collector does not retain
raw network addresses, browser descriptions, geography, device or browser
categories, accounts, cookies, query strings, full URLs, cross-site history, or
a raw event archive.

Interactive products require their own founder-approved data policy before
integration. The existence of this contract is not approval for a new consumer.

## Verification expectations

Focused tests must prove that:

- no request is sent before acceptance or after decline;
- GPC and DNT suppress collection;
- unexpected fields do not enter retained data;
- each consumer retains only its approved dimensions;
- daily visitor material cannot be compared across site namespaces; and
- finalization destroys daily secrets and visitor tokens before backup/export.
