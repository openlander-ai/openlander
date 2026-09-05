# Services

OpenLander's user-facing resources are:

| Kind        | What it is                                                 | MCP composite                |
| ----------- | ---------------------------------------------------------- | ---------------------------- |
| Application | Your app, API, worker, or image workload.                  | `openlander_service`         |
| Compose     | A compose stack represented as one Project-level resource. | `openlander_service`         |
| Database    | PostgreSQL, MySQL, MongoDB, or Neo4j.                      | `openlander_managed_service` |
| Cache       | Redis.                                                     | `openlander_managed_service` |
| Storage     | MinIO.                                                     | `openlander_managed_service` |

This page covers **Database/Cache/Storage resources**. Project-scoped Database/Cache/Storage resources run on
the same project Docker network as the app that uses them and are usually
connected through environment variables such as `DATABASE_URL` or `REDIS_URL`.
MCP-created Database/Cache/Storage resources require a target project in v0.1. Cross-project
shared Database/Cache/Storage resources and external TCP exposure are deferred.

For a Compose project, `GET /api/projects/:projectId/services` keeps the project-level response
by default. The dashboard can opt into child workloads with
`include_compose_children=true`. Child rows include their runtime role, lifecycle, health
strategy, traffic-target flag, and optional latest deploy summary; the response includes the
optional parent `aggregate_status`.

## Memory Limits

Open a Database/Cache/Storage service's **Overview → Resource Limits** to see its
actual Docker memory limit and choose a profile or enter a custom value. This
also works for existing PostgreSQL, MySQL, Redis, MongoDB, Neo4j, and MinIO containers.

Increases apply to the existing container without restarting or replacing it.
Stop the service before decreasing its limit, apply the change, then start it
again. Docker updates are verified before success is reported. Saved memory
limits are reused if platform recovery must recreate a missing container.
CPU settings remain unchanged; database engine memory settings are separate.

The existing `GET` and `PATCH /api/projects/:p/services/:s/resources` endpoints
return and update applied limits for Database/Cache/Storage resources. Application resource
settings retain their existing next-deployment behavior. If an update fails,
reload the current limits before retrying; a persistence failure can leave the
Docker limit applied while recovery settings still need to be saved.

## Available Templates

| Template       | Image                 | Default Port | Use Case                     |
| -------------- | --------------------- | ------------ | ---------------------------- |
| **PostgreSQL** | postgres:16           | 5432         | Relational database          |
| **MySQL**      | mysql:8               | 3306         | Relational database          |
| **Redis**      | redis:7               | 6379         | Cache / message broker       |
| **MongoDB**    | mongo:7               | 27017        | Document database            |
| **Neo4j**      | neo4j:2026.07.1       | 7687         | Graph database (Bolt)        |
| **RabbitMQ**   | rabbitmq:3-management | 5672         | Message queue                |
| **MinIO**      | minio/minio           | 9000         | S3-compatible object storage |
| **Custom**     | Any Docker image      | User-defined | Anything else                |

### PostgreSQL Extension-Ready Applications

PostgreSQL extensions do not need separate connection secrets. Keep `DATABASE_URL` as the only
PostgreSQL connection URL, select an image that already contains the required extension binaries,
and activate extensions through versioned application migrations. Do not install extension
packages into a running database container.

When an application genuinely supports multiple implementations, it may use an optional non-secret
selector. OpenLander reports but does not inject these values:

| PostgreSQL capability | Optional selector                      | OpenLander behavior |
| --------------------- | -------------------------------------- | ------------------- |
| pgvector              | `VECTOR_STORE_BACKEND=pgvector`        | Not auto-injected   |
| Apache AGE            | `GRAPH_STORE_BACKEND=age`              | Not auto-injected   |
| PostGIS               | `SPATIAL_STORE_BACKEND=postgis`        | Not auto-injected   |
| TimescaleDB           | `TIMESERIES_STORE_BACKEND=timescaledb` | Not auto-injected   |

These selectors are ordinary application configuration, not credentials, and OpenLander does not
inject them automatically. Do not create duplicate secrets such as `AGE_DATABASE_URL` or
`VECTOR_DATABASE_URL` while the capability uses the same PostgreSQL instance. Application
migrations should use an allowlisted `CREATE EXTENSION IF NOT EXISTS ...` statement and verify the
extension through `pg_available_extensions` / `pg_extension`.

For AGE, prefer a provider-neutral `GRAPH_NAMESPACE` over an AGE-specific graph-name variable.
OpenLander does not inject it automatically. Retain relational records as the migration source of
truth and treat the AGE graph as reconstructable data.

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

This creates infrastructure, connects it to the Project, and saves compatible
connection env vars on the target workload when one exists. It does not redeploy
the app; call `update_app` to apply the saved values to a running workload. The
response also returns `suggested_env` for review or manual configuration.

`create_service` requires `project_id` or `project_name` so the resource is
attached to the same isolated Docker network as the app that will use it.

---

## Resource Container Naming

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

For PostgreSQL and MySQL resources:

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

Neo4j is intentionally limited to the Community single-database model. The managed
resource enables only Bolt on port `7687`, disables the HTTP server, persists `/data`, and returns
`NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD`. Database and user creation,
the HTTP Browser port, and Enterprise-only multi-database features are not exposed.

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

### Keep Application Storage Portable

For a new MinIO connection, OpenLander injects `OBJECT_STORAGE_PROVIDER`,
`OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`, and `OBJECT_STORAGE_SECRET_KEY`. These are
application infrastructure inputs; map them to the selected provider SDK inside an adapter rather
than exposing provider credential names to domain code. New application code should:

- expose provider-neutral configuration such as `OBJECT_STORAGE_BUCKET`, optional
  `OBJECT_STORAGE_PREFIX`, and an infrastructure-selected backend;
- keep MinIO/S3, Amazon S3, and Google Cloud Storage SDK calls behind one application-owned
  object-storage interface;
- persist a logical store plus an opaque object key, not a full `s3://`, `gs://`, MinIO endpoint,
  or provider HTTP URL;
- keep bucket, prefix, endpoint, path-style addressing, and credentials in deployment config; and
- contract-test the portable operations the application actually uses, including signed URLs and
  metadata when applicable.

Google Cloud Storage HMAC/XML interoperability can be a useful migration bridge for an existing
S3 client, but it is not a guarantee that provider-specific ACL, metadata, multipart upload,
versioning, lifecycle, or event behavior is identical. Prefer a native provider adapter when those
features matter. Existing OpenLander Projects keep their `S3_ENDPOINT` / `AWS_*` compatibility
keys; OpenLander does not rename or remove them automatically. When an existing application needs
a newly connected MinIO resource, migrate its adapter explicitly or map the new `OBJECT_STORAGE_*`
inputs to its legacy SDK configuration rather than creating automatic aliases.

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
`archive_service` / `unarchive_service`. Archive and deployment serialize on the
same durable runtime lock, including Compose deployments. Stale stored
`building` markers are reconciled instead of blocking cleanup; a real active
operation returns `DEPLOY_LOCKED` with sanitized blocker evidence.

---

## Backups

The generic OpenLander volume backup and restore actions are not available for Neo4j.
A live tar copy of `/data` is not treated as a valid Neo4j backup. Use a reviewed,
Neo4j-supported offline dump/load or export/import procedure outside this v0.1 scope.

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

MCP env changes target Applications and save only by default. Prefer the Application
`service_id` returned by `list_projects()` (`projects[].deployable_service.service_id`
in v0.1.x compatibility output); `project_name` works only for Projects with exactly
one Application. Update the app with `update_app`, or pass
`defer_redeploy=false` to `set_env_vars`, for the new value to reach a running container.

Typical agent flow:

```
create_service(name: "my-postgres", template: "postgresql", project_name: "my-app")
get_service_credentials(service_name: "my-postgres")
# If auto_injected_env_keys is empty, save or override suggested_env manually.
update_app(service_id: "my-app__svc")
```

This standalone `create_service` flow is separate from deploy-plan approval.
When `execute_deploy_plan` approves a proposed project-scoped Database/Cache/Storage resource on
an existing project, that plan execution may provision the resource, write its
connection env, and deploy in one flow. Standalone `create_service` remains
explicit: create and connect infrastructure, review the saved/suggested env vars,
then call `update_app`.
