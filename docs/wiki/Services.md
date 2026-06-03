# Services

OpenLander's user-facing resources are:

| Kind               | What it is                                                          | MCP composite                |
| ------------------ | ------------------------------------------------------------------- | ---------------------------- |
| Application        | Your app, API, worker, or image workload.                           | `openlander_service`         |
| Compose            | A compose stack represented as one Project-level resource.           | `openlander_service`         |
| Database           | PostgreSQL, MySQL, or MongoDB.                                      | `openlander_managed_service` |
| Cache              | Redis.                                                              | `openlander_managed_service` |
| Storage            | MinIO.                                                              | `openlander_managed_service` |

This page covers **Database/Cache/Storage resources**. Project-scoped Database/Cache/Storage resources run on
the same project Docker network as the app that uses them and are usually
connected through environment variables such as `DATABASE_URL` or `REDIS_URL`.
MCP-created Database/Cache/Storage resources require a target project in v0.1. Cross-project
shared Database/Cache/Storage resources and external TCP exposure are deferred.

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

## Create a Database/Cache/Storage resource

### Via Web Dashboard

The web dashboard does not create Database/Cache/Storage resources in v0.1. Use the Project
Resources tab to inspect connected Database/Cache/Storage resources and open their
project-scoped detail pages for logs, connections, start/stop, and typed-confirm
delete.

### Via MCP

```
create_service(name: "my-postgres", template: "postgresql", project_name: "my-app")
```

This creates infrastructure and returns connection guidance. It does not write
app env vars, deploy, or redeploy your app by itself. To use the new resource
from an app, read credentials or `suggested_env`, then call `set_env_vars` on
the Application.

`create_service` requires `project_id` or `project_name` so the resource is
attached to the same isolated Docker network as the app that will use it.

---

## Service Naming

Container names follow the pattern: `ol-svc-{name}`

Example: `create_service(name: "mydb", template: "postgresql", project_name: "my-app")` → container `ol-svc-mydb`

---

## Get Credentials

### Via Web Dashboard

Project → Resources → Database/Cache/Storage resource detail → **Connections**.

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

Application cleanup is softer: MCP `archive_service` creates a human
approval request and, after approval, archives the Application while preserving
configuration and history. MCP `unarchive_service` uses the same approval queue
to restore an archived Application without redeploying it. These are not a
substitute for Database/Cache/Storage resource deletion and do not delete databases, volumes,
buckets, or host-wide Docker resources.

Project archive/restore is also available to MCP agents through
`archive_project` / `unarchive_project`, but it enters the same human approval
queue before executing. A Project archive spans active Applications; a restore does not redeploy
Applications automatically. For one Application, prefer a specific `service_id` with
`archive_service` / `unarchive_service`.

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

Project-scoped Database/Cache/Storage resources run on the same Docker network as their owning
project. Applications in that project can connect using the managed
resource container name as hostname:

```
# In the Application env vars:
DATABASE_URL=postgresql://user:pass@ol-svc-my-postgres:5432/myapp
REDIS_URL=redis://ol-svc-my-redis:6379
```

Use project-scoped Database/Cache/Storage resources as the default app database/cache path.
Creating cross-project shared resources is not exposed in v0.1.

If an app previously used an unassigned/global Database/Cache/Storage resource as its primary
database or cache, recreate that Database/Cache/Storage resource inside the app's project,
update the app env vars to the project-scoped connection string, and redeploy
the app. After upgrading to v0.1, redeploy apps promptly so older app
containers do not remain on the old shared network while Database/Cache/Storage resources move
to the project network.

OpenLander does not publish Database/Cache resource ports outside Docker in
v0.1. If an app needs a database outside OpenLander, bring an external
connection string and set it as an app env var; OpenLander will not create a
shared Database/Cache/Storage resource or public TCP endpoint for it.

Set via MCP on the Application:

```
set_env_vars(
  service_id: "my-app__svc",
  variables: {
    DATABASE_URL: "postgresql://user:pass@ol-svc-my-postgres:5432/myapp"
  }
)
```

MCP env changes target Applications and save only by default. Prefer `service_id` from
`list_projects().projects[].deployable_service.service_id`; `project_name` works only for groups
with exactly one Application. Redeploy the app with `redeploy_app`, or pass
`defer_redeploy=false` to `set_env_vars`, for the new value to reach a running container.

Typical agent flow:

```
create_service(name: "my-postgres", template: "postgresql", project_name: "my-app")
get_service_credentials(service_name: "my-postgres")
set_env_vars(service_id: "my-app__svc", variables: { DATABASE_URL: "..." })
redeploy_app(service_id: "my-app__svc")
```

This standalone `create_service` flow is separate from deploy-plan approval.
When `execute_deploy_plan` approves a proposed project-scoped Database/Cache/Storage resource on
an existing project, that plan execution may provision the resource, write its
connection env, and deploy in one flow. Standalone `create_service` remains
explicit: create infrastructure, then set env vars, then redeploy.
