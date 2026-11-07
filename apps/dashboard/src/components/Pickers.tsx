import type { ClientDto, MatterDto } from '@assar/api-client';
import { SelectField } from '@assar/ui';
import { useAuth } from '../lib/auth';
import { usePeople } from '../lib/people';
import { useAsync } from '../lib/useAsync';

interface PickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  blank?: string;
}

export function useClients() {
  const { client } = useAuth();
  const s = useAsync(() => client.clients({ limit: 100, status: 'active' }), [client]);
  return s.status === 'ready' ? s.data.data : ([] as ClientDto[]);
}
export function useMatters(clientId?: string) {
  const { client } = useAuth();
  const s = useAsync(() => client.matters({ limit: 100, clientId }), [client, clientId]);
  return s.status === 'ready' ? s.data.data : ([] as MatterDto[]);
}

export function ClientPicker({ blank, ...p }: PickerProps) {
  const clients = useClients();
  return (
    <SelectField
      id={p.id}
      label={p.label}
      value={p.value}
      error={p.error}
      required={p.required}
      onChange={(e) => p.onChange(e.target.value)}
    >
      <option value="">{blank ?? 'Select a client…'}</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </SelectField>
  );
}

export function MatterPicker({ blank, clientId, ...p }: PickerProps & { clientId?: string }) {
  const matters = useMatters(clientId);
  return (
    <SelectField
      id={p.id}
      label={p.label}
      value={p.value}
      error={p.error}
      required={p.required}
      onChange={(e) => p.onChange(e.target.value)}
    >
      <option value="">{blank ?? 'Select a matter…'}</option>
      {matters.map((m) => (
        <option key={m.id} value={m.id}>
          {m.matterNumber} — {m.title}
        </option>
      ))}
    </SelectField>
  );
}

export function MemberPicker({ blank, ...p }: PickerProps) {
  const { members } = usePeople();
  return (
    <SelectField
      id={p.id}
      label={p.label}
      value={p.value}
      error={p.error}
      onChange={(e) => p.onChange(e.target.value)}
    >
      <option value="">{blank ?? 'Unassigned'}</option>
      {members
        .filter((m) => m.status === 'active')
        .map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
    </SelectField>
  );
}
