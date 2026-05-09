import { type Service } from '@/lib/api';
import { ServiceLogViewer } from './ServiceLogViewer';

interface ServiceLogsTabProps {
  service: Service;
}

export function ServiceLogsTab({ service }: ServiceLogsTabProps) {
  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex-1 min-h-0">
        <ServiceLogViewer serviceId={service.id} status={service.status} />
      </div>
    </div>
  );
}
