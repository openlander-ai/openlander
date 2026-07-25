# Engagement Portfolio

Engagement Portfolio is an internal FDE workspace above Projects:

```text
Engagement → one or more Projects → Deliveries → immutable Receipts
```

An Engagement is not a customer account, ticket system, or deployment target.
It groups existing Projects so an FDE can find runtime problems and delivery
blockers across one customer engagement without changing the underlying
Project, Service, Delivery, or Receipt.

## Data model

- A Project can belong to at most one Engagement.
- Existing Projects remain **Unassigned** until an administrator links them.
- Archiving an Engagement preserves every Project link and does not stop or
  archive Projects, Services, or Deliveries.
- Archived Engagements cannot be edited or relinked until they are unarchived.
- There is no Engagement hard-delete operation.
- Deliveries and Receipts have no Engagement foreign key. Moving a Project
  cannot invalidate a Delivery evidence version, Receipt snapshot, or PDF hash.

Use synthetic customer names in public examples and tests. Real customer names
and delivery evidence belong only in a private OpenLander instance.

## Portfolio status

The list and detail screens keep runtime and delivery status separate:

- `runtime_health` is `degraded` when any linked active Project has a runtime
  error, `healthy` when at least one active Project exists without an error,
  and `unknown` when no linked active Project exists.
- `delivery_summary` counts Deliveries by status and counts how many Deliveries
  currently have at least one blocker.

A Delivery is blocked when it is `revision_requested`, a required Gate failed,
a Gate warning is not acknowledged, or a confirmed question/change request is
unresolved. A linked Project runtime error is also shown as a portfolio
blocker, but it is kept separate from the blocked-Delivery count.

## Web workflow

Open **Engagements** in the Workspace sidebar to:

1. Create an internal Engagement.
2. Link one or more Unassigned Projects.
3. Review linked Project runtime, Delivery maturity/status, blockers, and
   recent activity.
4. Follow deep links to the owning Project or Delivery.
5. Edit, archive, or unarchive the Engagement.

Creation, editing, linking, unlinking, archive, and unarchive require an
authenticated administrator web session. API tokens and Project PATs cannot
mutate Engagements.

## MCP reads

The existing `openlander_project` composite exposes:

- `list_engagements`
- `get_engagement`

These are compact, read-only summaries for instance/organization-scoped
agents. Project- and service-scoped tokens receive `SCOPE_VIOLATION` so they
cannot infer sibling Project data. Detailed artifacts, raw feedback, Gate
evidence, and Receipt metadata remain on the existing Delivery actions.
