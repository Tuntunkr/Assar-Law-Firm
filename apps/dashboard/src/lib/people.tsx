import type { MemberDto } from '@assar/api-client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth';

interface People {
  members: MemberDto[];
  name(userId: string | null | undefined): string;
}
const Ctx = createContext<People>({ members: [], name: () => '—' });
export const usePeople = () => useContext(Ctx);

/** Loads the firm's members once so lists can show names instead of ids. Staff roles without access just see ids hidden. */
export function PeopleProvider({ children }: { children: ReactNode }) {
  const { client, state } = useAuth();
  const [members, setMembers] = useState<MemberDto[]>([]);
  const authed = state.status === 'authed';
  useEffect(() => {
    if (!authed) return;
    let live = true;
    client
      .members({ limit: 100 })
      .then((p) => live && setMembers(p.data))
      .catch(() => undefined); // not every role may list members; names then fall back to "—"
    return () => {
      live = false;
    };
  }, [client, authed]);
  const value = useMemo<People>(() => {
    const byId = new Map(members.map((m) => [m.userId, m.name]));
    return { members, name: (id) => (id ? (byId.get(id) ?? 'Unknown') : '—') };
  }, [members]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
