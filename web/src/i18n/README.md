# Translations

`en.ts` and `ko.ts` are the source of truth for user-facing dashboard copy.
Read [`docs/i18n-policy.md`](../../../docs/i18n-policy.md) before changing it.

## Quick rule

Localize the user's task and status, not every English token. Keep established
developer terms when Korean wording would be less precise, along with proper
names, protocols, code, logs, and machine identifiers.

The two locale files must keep the same key tree and interpolation
placeholders. Components should use `t()` instead of embedding user-facing
fallback text.
