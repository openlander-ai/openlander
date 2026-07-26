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

The Web keeps creation, editing, linking, unlinking, archive, and unarchive as
human exception controls. Normal automation uses the Application Operation
Registry through MCP or `POST /api/v1/operations/:name`; it does not depend on a
Web form.

## Agent interface

The existing `openlander_project` composite exposes:

- `bootstrap_engagement`
- `update_engagement_from_brief`
- `link_project_to_engagement`
- `unlink_project_from_engagement`
- `archive_engagement`
- `unarchive_engagement`
- `list_engagements`
- `get_engagement`

`bootstrap_engagement` atomically creates an Engagement and its initial empty
Project through the shared Application Operation Registry. Every mutation
requires an `idempotency_key`; exact retries replay the original response and a
changed input with the same key returns `OPERATION_IDEMPOTENCY_CONFLICT`. The two
read actions remain compact summaries. Portfolio reads and Engagement-wide
mutations require instance/organization scope. Link/unlink also permits a
Project token when `project_id` exactly matches its own scope; sibling access and
service tokens receive `SCOPE_VIOLATION`. Detailed artifacts, raw feedback, Gate
evidence, and Receipt metadata remain on the existing Delivery actions.
