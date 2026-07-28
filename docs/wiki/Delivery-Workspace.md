# Delivery Workspace

Delivery Workspace is OpenLander's project-scoped handoff record for FDE and
implementation work:

```text
review artifacts → customer feedback → confirmed decisions
→ external QA/Data Gates → Production deployment → immutable Receipt PDF
```

Customers do not log in to OpenLander. Slack, email, Teams, and meetings remain
the communication channels; the FDE preserves the source material and official
result in OpenLander.

## What OpenLander owns

- Versioned HTML, PDF, Markdown, report, and image artifacts in
  content-addressed storage.
- Pasted source feedback plus optional external evidence URLs.
- Agent-proposed decisions, change requests, questions, and notes.
- Human-confirmed work items and customer approval evidence.
- Results produced by external Review, QA, Data, or Custom Gates.
- Links to successful Production deployments in the same Project.
- A deterministic Readiness result and immutable final Receipt snapshot.

OpenLander does not run arbitrary uploaded HTML, execute QA, automatically read
Slack, or turn AI drafts into official decisions.

## Workflow

1. Open a Project, select **Deliveries**, and create either a
   `software_release` or `artifact_delivery`.
2. Upload the storyboard HTML and an equivalent companion PDF with the same
   logical key and revision. Approve the final artifacts.
3. Paste customer feedback. An external MCP agent can read it and submit
   proposed structured work items.
4. Confirm or reject the proposals in the web UI. Resolve every confirmed
   question and change request.
5. Record the customer approver display name, source, time, approval wording,
   and approved artifact revisions.
6. Record external Gate results. A failed JUnit report cannot be marked passed.
7. For software releases, link a successful same-Project Production deployment
   as `released`.
8. Review Readiness, generate the complete PDF preview, then finalize from an
   administrator web session.

A finalized Delivery is locked. Corrections use a new Delivery whose
`predecessor_delivery_id` points to the earlier record.

The preview is version-bound. Any artifact, approval, work item, Gate,
deployment link, Delivery metadata, or Receipt-theme change invalidates the
previous preview, and finalization requires a newly generated preview of the
current evidence.

## Receipt

Project Settings controls the organization name, document name, primary color,
PNG/JPEG logo, footer, Korean/English language, and default Gate requirements.
The evidence layout is intentionally fixed.

The Receipt includes:

1. Delivery identity and scope
2. Confirmed decisions and approval evidence
3. Gate summaries and linked report IDs
4. Deployment, service, environment, and commit evidence
5. Known limitations
6. Approved artifact names and SHA-256 values
7. Readiness checks
8. Every approved companion PDF in configured order

The final PDF and the database data used to generate it are stored as one
immutable snapshot. Finalization is blocked above 250 pages.

## Files and security

- The web UI shows current customer review files first. Active `review_html`,
  `companion_pdf`, and the exact Artifact bound to a Review Gate are treated as
  customer shareables. QA/Data reports, Markdown, images, and other supporting
  files stay under internal evidence unless selected by a Review Gate.
- Customer records that point to the same immutable blob are displayed once.
  Superseded versions and duplicate records remain preserved and are available
  in the collapsed history section. This changes presentation only; it does not
  delete evidence or alter Receipt snapshots.
- Maximum file size: 100 MiB
- Accepted formats: HTML, PDF, Markdown, JSON, XML/JUnit, PNG, JPEG, and WebP
- HTML is always downloaded as an attachment and never rendered on the
  authenticated OpenLander origin.
- Files are stored by SHA-256 below
  `~/.openlander/artifacts/sha256/<prefix>/<hash>`; display filenames never
  become storage paths.
- External URLs are optional metadata. A Slack or Drive link is never required
  to read or regenerate OpenLander's preserved evidence.

## External agents and CI

Delivery metadata uses the existing `openlander_project` MCP composite. For a
local file, an MCP Agent first calls `create_evidence_upload`, then sends the
exact bytes with `PUT` to the returned 15-minute bearer `upload_url`. The upload
request does not use the MCP token as REST authentication, and the capability
URL must not be logged or shared.

The multipart REST route remains available to the web UI and supported CI
clients. Project-scoped PATs may POST only Delivery artifact and Gate-result CI
routes and must include `Idempotency-Key`; an MCP token is not a PAT and is
rejected by those routes.

Agents that need a human checkpoint before an external side effect should call
`request_delivery_review` with the exact latest Artifact ID and blob SHA-256,
then poll `get_delivery_review_status`. The compact status deliberately does
not execute the external change. A passed checkpoint and customer approval
evidence are reported separately, so an Agent cannot mistake review for proof
that an import or rollout completed.

The Delivery Gates tab shows the bound filename, revision, and SHA-256 as one
review checkpoint. Its **Accept this version** action calls the Web-session-only
`accept_delivery_review` Application Operation, which atomically approves the
exact Artifact and passes the linked Review Gate. Raw REST API tokens and MCP
Agents cannot execute that human decision. Uploading a newer revision makes the
old target stale and requires another review request.

Gate submissions keep an immutable idempotency record. Retrying the same key
returns the original response even if a later Gate result exists; reusing the
key with different request content returns `IDEMPOTENCY_KEY_CONFLICT`.

MCP can generate a Receipt preview but cannot finalize a Receipt. Calls named
`finalize_delivery` or `finalize_delivery_receipt` return `HUMAN_UI_ONLY` and
point to the Delivery Receipt page.

For internal cross-Project oversight, see [[Engagement Portfolio]]. Linking or
unlinking a Project from an Engagement never changes this Delivery's evidence
version, finalized Receipt snapshot, or PDF SHA-256.
