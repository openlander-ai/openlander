/* eslint-disable openlander-internal/no-dropped-columns */
/**
 * Lint note: reads `service.type` / `service.port` off the typed wire
 * shape exposed by `@/lib/api`, not the dropped DB columns. The wire
 * layer aliases services.kind→type and services.assigned_port→port for
 * backward compatibility. The no-dropped-columns rule is name-based and
 * would misfire here.
 */
import { useEffect, useState } from 'react';
import { Database, Users, Plus, Copy, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/context';
import {
  getServiceDatabases,
  getServiceUsers,
  createServiceDatabase,
  createServiceUser,
  type Service,
  type ServiceDatabase,
  type ServiceUser,
} from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCopy } from '@/hooks/use-copy';
import { localizeApiError } from '@/lib/localized-api-error';

function formatBytes(bytes: number | null, unknownLabel: string): string {
  if (bytes == null) return unknownLabel;
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface ServiceDatabasesTabProps {
  service: Service;
}

export function ServiceDatabasesTab({ service }: ServiceDatabasesTabProps) {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [databases, setDatabases] = useState<ServiceDatabase[]>([]);
  const [users, setUsers] = useState<ServiceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);

  const [newDbName, setNewDbName] = useState('');
  const [creatingDb, setCreatingDb] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserDatabase, setNewUserDatabase] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [dbs, usrs] = await Promise.all([
        getServiceDatabases(service.id),
        getServiceUsers(service.id),
      ]);
      setDatabases(dbs);
      setUsers(usrs);
    } catch (err) {
      setError(
        localizeApiError(
          err,
          t,
          'services.detail.toasts.loadDatabasesFailed',
          'common.errors.codes',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [service.id]);

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbName.trim()) return;

    try {
      setCreatingDb(true);
      const res = await createServiceDatabase(service.id, newDbName.trim());
      toast.success(t('services.detail.toasts.dbCreated'));
      setCreateDbOpen(false);
      setNewDbName('');
      void fetchData();

      if (res.connectionString) {
        await copyToClipboard(res.connectionString);
        toast.success(t('services.detail.toasts.connStringCopied'));
      }
    } catch (err) {
      toast.error(
        localizeApiError(err, t, 'services.detail.toasts.dbCreateFailed', 'common.errors.codes'),
      );
    } finally {
      setCreatingDb(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    try {
      setCreatingUser(true);
      const res = await createServiceUser(
        service.id,
        newUsername.trim(),
        newUserPassword || undefined,
        newUserDatabase || undefined,
      );
      toast.success(t('services.detail.toasts.userCreated'));
      setCreateUserOpen(false);
      setNewUsername('');
      setNewUserPassword('');
      setNewUserDatabase('');
      void fetchData();

      if (res.connectionString) {
        await copyToClipboard(res.connectionString);
        toast.success(t('services.detail.toasts.connStringCopied'));
      }
    } catch (err) {
      toast.error(
        localizeApiError(err, t, 'services.detail.toasts.userCreateFailed', 'common.errors.codes'),
      );
    } finally {
      setCreatingUser(false);
    }
  };

  const handleCopyConnString = (text: string, id: string) => {
    void copy(text, id);
    toast.success(t('services.detail.toasts.copiedToClipboard'));
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground animate-pulse">
        {t('services.detail.loadingDatabases')}
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-error bg-error/10 p-4 rounded-md">{error}</div>;
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Database className="h-4 w-4" />
            {t('serviceDialogs.databases')}
          </div>
          <Button size="sm" onClick={() => setCreateDbOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('serviceDialogs.createDatabase')}
          </Button>
        </div>

        {databases.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-8 text-center">
            {t('serviceDialogs.noDatabases')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {databases.map((db) => {
              let connString = '';
              if (service.credentials) {
                try {
                  const creds = JSON.parse(service.credentials);
                  if (service.type === 'postgresql') {
                    connString = `postgresql://${creds.user}:${creds.password}@${service.container_name}:${service.port}/${db.name}`;
                  } else if (service.type === 'mysql') {
                    connString = `mysql://${creds.user}:${creds.password}@${service.container_name}:${service.port}/${db.name}`;
                  } else if (service.type === 'mongodb') {
                    connString = `mongodb://${creds.user}:${creds.password}@${service.container_name}:${service.port}/${db.name}`;
                  }
                } catch {
                  // Ignore parse errors
                }
              }

              return (
                <div
                  key={db.name}
                  className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="font-mono text-sm text-foreground mb-1">{db.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(db.sizeBytes, t('serviceDialogs.unknownSize'))}
                    </div>
                  </div>
                  {connString && (
                    <div className="mt-4 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => handleCopyConnString(connString, `db-${db.name}`)}
                      >
                        {isCopied(`db-${db.name}`) ? (
                          <Check className="h-3.5 w-3.5 mr-1.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        {t('serviceDialogs.copyUrl')}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="h-4 w-4" />
            {t('serviceDialogs.users')}
          </div>
          <Button size="sm" onClick={() => setCreateUserOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('serviceDialogs.createUser')}
          </Button>
        </div>

        {users.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-8 text-center">
            {t('serviceDialogs.noUsers')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {users.map((user) => (
              <div
                key={user.name}
                className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-3 flex items-center gap-3"
              >
                <div className="h-8 w-8 rounded-full bg-foreground/10 flex items-center justify-center shrink-0">
                  <Users className="h-4 w-4 text-foreground" />
                </div>
                <div className="font-mono text-sm text-foreground truncate">{user.name}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={createDbOpen} onOpenChange={setCreateDbOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('serviceDialogs.createDatabase')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateDatabase} className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('serviceDialogs.databaseName')}
              </label>
              <Input
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                placeholder="my_new_db"
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateDbOpen(false)}>
                {t('serviceDialogs.cancel')}
              </Button>
              <Button type="submit" disabled={creatingDb || !newDbName.trim()}>
                {creatingDb && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('serviceDialogs.createShort')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('serviceDialogs.createUser')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('serviceDialogs.username')}
              </label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="new_user"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('serviceDialogs.passwordOptional')}
              </label>
              <Input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder={t('serviceDialogs.passwordAutoGenerate')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('serviceDialogs.grantAccessOptional')}
              </label>
              <Select value={newUserDatabase} onValueChange={setNewUserDatabase}>
                <SelectTrigger>
                  <SelectValue placeholder={t('services.detail.selectDatabase')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('serviceDialogs.noDatabaseAccess')}</SelectItem>
                  {databases.map((db) => (
                    <SelectItem key={db.name} value={db.name}>
                      {db.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateUserOpen(false)}>
                {t('serviceDialogs.cancel')}
              </Button>
              <Button type="submit" disabled={creatingUser || !newUsername.trim()}>
                {creatingUser && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('serviceDialogs.createShort')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
