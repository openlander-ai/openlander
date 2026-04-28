# i18n Patches — 1.0-rc.2 (Data Model Full Split)

> Per `MEMORY.md` rule: never edit `web/src/i18n/{en,ko}.ts` directly.
> User merges manually.

## Renames

`web/src/i18n/en.ts` and `web/src/i18n/ko.ts`:

- `services.detail.header.backToServices` → `services.detail.header.backToProjectServices` (en: "Back to project services" / "프로젝트 서비스로 돌아가기")

## New strings (en + ko)

- `groups.detail.title`: "Group" / "그룹"
- `groups.detail.servicesTab`: "Services" / "서비스"
- `services.kind.compose`: "Compose" / "Compose 스택"
- `services.kind.compose-child`: "Compose Container" / "Compose 컨테이너"
- `services.kind.git`: "Git Service" / "Git 서비스"
- `services.kind.image`: "Image Service" / "이미지 서비스"
- `services.kind.postgres`: "PostgreSQL" / "PostgreSQL"
- `services.kind.mysql`: "MySQL" / "MySQL"
- `services.kind.redis`: "Redis" / "Redis"
- `services.kind.mongo`: "MongoDB" / "MongoDB"
- `services.kind.minio`: "MinIO" / "MinIO"

## Deletions

(none — keep all rc.1 keys for backward compat through 2.0)
