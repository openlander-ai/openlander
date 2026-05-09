# Services

OpenLander can provision and manage infrastructure services as Docker containers.

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

## Create a Service

### Via Web Dashboard

1. Go to **Services** → **Create New**
2. Select a template (or custom image)
3. Name the service
4. Click Create

### Via MCP

```
create_service(name: "my-postgres", template: "postgresql")
```

---

## Service Naming

Container names follow the pattern: `ol-svc-{name}`

Example: `create_service(name: "mydb")` → container `ol-svc-mydb`

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

Services run on the `openlander` Docker network. Projects can connect using the service container name as hostname:

```
# In the deployable service env vars:
DATABASE_URL=postgresql://user:pass@ol-svc-my-postgres:5432/myapp
REDIS_URL=redis://ol-svc-my-redis:6379
```

Set via MCP:

```
set_env_vars(
  service_name: "my-app-web",
  variables: {
    DATABASE_URL: "postgresql://user:pass@ol-svc-my-postgres:5432/myapp"
  }
)
```

MCP env changes target deployable services and save only by default. Use `service_id` or
`service_name`; `project_name` works only for groups with exactly one deployable service.
Redeploy the app with `deploy_service`, or pass `defer_redeploy=false` to `set_env_vars`,
for the new value to reach a running container.
