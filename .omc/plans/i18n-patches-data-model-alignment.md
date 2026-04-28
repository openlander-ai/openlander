# i18n Patch Proposal — Data Model Alignment 1.0

> **Per the project rule** (memory: `feedback_i18n_patch_only`):
> never directly edit `web/src/i18n/{en,ko}.ts`. This file is a patch
> proposal — user merges manually across parallel sessions.

## Context

Phase 1 of `ralplan-data-model-alignment` introduced `/managed-services`
as the new list URL (formerly `/services`). The user-visible "Back to
Services" string at `web/src/i18n/en.ts:1021` (and `ko.ts:1017`) is
currently rendered only by `web/src/components/service/ServiceHeader.tsx`,
which is dead code today (no imports). The plan intentionally keeps the
key alive — the `vocabulary-audit.test.ts` lint guard asserts its
existence — so 1.1's component-rewire pass (which revives
ServiceHeader under `ManagedServiceDetail`) doesn't get blocked on i18n
review.

This patch updates the visible copy to match the new noun.

## Patch — `web/src/i18n/en.ts`

Around line 1021, in the `services.detail.header` namespace:

```diff
   header: {
-    backToServices: 'Back to Services',
+    backToServices: 'Back to Managed Services',
```

## Patch — `web/src/i18n/ko.ts`

Around line 1017, in the same namespace:

```diff
   header: {
-    backToServices: '서비스 목록으로',
+    backToServices: '관리 서비스 목록으로',
```

## Why minimal

The plan deliberately avoided wholesale `services.*` → `managed-services.*`
key renames. That namespace has ~75 keys and renaming them in 1.0 risks
churn that 1.1 (component rewire) and 1.2 (schema split) will partly
undo. One copy edit on the live-rendering string is the highest-value
change.

## Verification

After merging, the `vocabulary-audit.test.ts` `backToServices` key
existence check still passes (the key name is unchanged — only the
value changed).
