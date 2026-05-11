# Translations

`en.ts` and `ko.ts` are the source of truth for every user-facing
string in the dashboard. Before adding or editing a key, read the
copy policy:

→ [`docs/i18n-policy.md`](../../../docs/i18n-policy.md)

## Quick rule

**Menu/button labels stay in English in both files. Descriptions
translate.**

Same key tree in both files. Chrome keys (buttons, nav, tabs, table
headers, short verbs) carry the same English string on both sides.
Content keys (subtitles, descriptions, errors with context, paragraph
help) get locale-native Korean in `ko.ts`.

See the _Mechanical convention_ table in the policy doc for how to
default the register from the key name.
