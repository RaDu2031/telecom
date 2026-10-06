import { db } from '../lib/firebaseClient';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';

export interface ChamadoTicket {
  id?: string;
  protocolo: string;
  titulo: string;
  descricao: string;
  categoria: 'Dúvida Técnica' | 'Acesso / Permissão' | 'Erro em Site / Planilha' | 'Outros';
  prioridade: 'Baixa' | 'Média' | 'Alta' | 'Urgente';
  status: 'Aberto' | 'Em Atendimento' | 'Resolvido' | 'Cancelado';
  usuarioNome: string;
  usuarioEmail: string;
  usuarioRole: string;
  usuarioId: string;
  respostaAdmin?: string;
  atendidoPor?: string;
  atendidoEm?: string;
  createdAt: string;
  updatedAt: string;
}

export const CHAMADOS_COLLECTION = 'chamados';

export async function criarChamado(
  ticket: Omit<ChamadoTicket, 'id' | 'createdAt' | 'updatedAt' | 'protocolo' | 'status'>
): Promise<string> {
  const protocolo = `CHM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, CHAMADOS_COLLECTION), {
    ...ticket,
    protocolo,
    status: 'Aberto',
    createdAt: now,
    updatedAt: now,
  });
  return docRef.id;
}

export async function atualizarStatusChamado(
  id: string,
  status: ChamadoTicket['status'],
  respostaAdmin?: string,
  adminName?: string
): Promise<void> {
  const docRef = doc(db, CHAMADOS_COLLECTION, id);
  await updateDoc(docRef, {
    status,
    respostaAdmin: respostaAdmin || null,
    atendidoPor: adminName || 'Administrador',
    atendidoEm: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function subscribeChamados(
  onUpdate: (chamados: ChamadoTicket[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, CHAMADOS_COLLECTION), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ChamadoTicket[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChamadoTicket, 'id'>),
      }));
      onUpdate(list);
    },
    (error) => {
      console.error('Erro no onSnapshot de chamados:', error);
      if (onError) onError(error);
    }
  );
}
