# Services

OpenLander has two service concepts:

| Kind               | What it is                                                          | MCP composite                |
| ------------------ | ------------------------------------------------------------------- | ---------------------------- |
| Deployable service | Your app, API, worker, or compose child.                            | `openlander_service`         |
| Managed service    | Infrastructure such as PostgreSQL, MySQL, Redis, MongoDB, or MinIO. | `openlander_managed_service` |

This page covers **managed services**. Project-scoped managed services run on
the same project Docker network as the app that uses them and are usually
connected through environment variables such as `DATABASE_URL` or `REDIS_URL`.
Global services stay on the shared OpenLander network and are intended only for
deliberately shared or currently unassigned infrastructure.

## Available Templates

| Template       | Image                 | Default Port | Use Case                     |
| -------------- | --------------------- | ------------ | ---------------------------- |
| **PostgreSQL** | postgres:16           | 5432         | Relational database          |
| **MySQL**      | mysql:8               | 3306         | Relational database          |
| **Redis**      | redis:7               | 6379         | Cache / message broker       |
| **MongoDB**    | mongo:7               | 27017        | Document database            |
| **RabbitMQ**   | rabbitmq:3-management | 5672         | Message queue                |
| **MinIO**      | minio/minio           | 9000         | S3-compatible object storage |
| **Custom**     | Any Docker image      | User-defined | Anything else                |

---

## Create a Managed Service

### Via Web Dashboard

1. Go to **Services** → **Create New**
2. Select a template (or custom image)
3. Name the service
4. Click Create

### Via MCP

```
create_service(name: "my-postgres", template: "postgresql", project_name: "my-app")
```

This creates infrastructure. It does not deploy or redeploy your app. To use the new service from an
app, read credentials and set env vars on the deployable service.

By default, `create_service` requires `project_id` or `project_name` so the
service is attached to the app that will use it. Use `scope: "global"` only for
intentionally shared or currently unassigned infrastructure.

---

## Service Naming

Container names follow the pattern: `ol-svc-{name}`

Example: `create_service(name: "mydb", template: "postgresql", project_name: "my-app")` → container `ol-svc-mydb`

---

## Get Credentials

### Via Web Dashboard

Service Detail → **Connection** tab → copy host, port, credentials

### Via MCP

```
get_service_credentials(service_name: "my-postgres")
```

Returns: host, port, username, password, connection string.

---

## Database Operations

For PostgreSQL and MySQL services:

### Create Database

```
create_database(service_name: "my-postgres", database_name: "myapp")
```

### List Databases

```
list_databases(service_name: "my-postgres")
```

### Create User

```
create_service_user(
  service_name: "my-postgres",
  username: "app_user",
  database: "myapp"
)
```

Password is auto-generated if omitted.

---

## MinIO (S3 Storage)

### Create Bucket

```
create_bucket(service_name: "my-minio", bucket_name: "uploads")
```

### List Buckets

```
list_buckets(service_name: "my-minio")
```

### Delete Bucket

```
delete_bucket(service_name: "my-minio", bucket_name: "uploads")
```

---

## Service Lifecycle

| Action | MCP Tool             | Description             |
| ------ | -------------------- | ----------------------- |
| Start  | `start_service`      | Start a stopped service |
| Stop   | `stop_service`       | Stop a running service  |
| Remove | Web UI only          | Typed-confirm deletion  |
| Logs   | `get_service_logs`   | View container logs     |
| Status | `get_service_status` | Health, state, uptime   |

Service deletion is intentionally human-only in OpenLander 0.1. MCP `remove_service`
returns `OPERATION_REQUIRES_HUMAN_UI`; open the service page and use the delete
action there. Service-owned env vars, domains, and resource settings cascade with
the service. Managed project volumes are preserved by default and require an
explicit checkbox to delete.

---

## Backups

### Create Backup

```
backup_service(service_name: "my-postgres")
```

### List Backups

```
list_service_backups(service_name: "my-postgres")
```

### Restore

```
restore_service(service_name: "my-postgres", backup_id: "backup_xxx")
```

---

## Connecting Projects to Services

Project-scoped managed services run on the same Docker network as their owning
project. Deployable services in that project can connect using the managed
service container name as hostname:

```
# In the deployable service env vars:
DATABASE_URL=postgresql://user:pass@ol-svc-my-postgres:5432/myapp
REDIS_URL=redis://ol-svc-my-redis:6379
```

Do not use `scope: "global"` as the default app database path. Global services
are shared/unassigned infrastructure and are not joined to project networks in
v0.1.2.

Set via MCP on the deployable service:

```
set_env_vars(
  service_id: "my-app__svc",
  variables: {
    DATABASE_URL: "postgresql://user:pass@ol-svc-my-postgres:5432/myapp"
  }
)
```

MCP env changes target deployable services and save only by default. Prefer `service_id` from
`list_projects().projects[].deployable_service.service_id`; `project_name` works only for groups
with exactly one deployable service. Redeploy the app with `redeploy_app`, or pass
`defer_redeploy=false` to `set_env_vars`, for the new value to reach a running container.

Typical agent flow:

```
create_service(name: "my-postgres", template: "postgresql", project_name: "my-app")
get_service_credentials(service_name: "my-postgres")
set_env_vars(service_id: "my-app__svc", variables: { DATABASE_URL: "..." })
redeploy_app(service_id: "my-app__svc")
```
