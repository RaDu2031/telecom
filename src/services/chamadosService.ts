import { db } from '../lib/firebaseClient';
import { sanitizeFirestoreData } from './dataService';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  where,
  getDocs,
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
  uid: string; // user uid
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
  try {
    const docRef = await addDoc(collection(db, CHAMADOS_COLLECTION), sanitizeFirestoreData({
      ...ticket,
      protocolo,
      status: 'Aberto',
      createdAt: now,
      updatedAt: now,
    }));
    return docRef.id;
  } catch (error: any) {
    console.error('Erro ao criar chamado:', error);
    throw new Error(`Falha ao criar chamado: ${error.message || error}`);
  }
}

export async function atualizarStatusChamado(
  id: string,
  status: ChamadoTicket['status'],
  respostaAdmin?: string,
  adminName?: string
): Promise<void> {
  const docRef = doc(db, CHAMADOS_COLLECTION, id);
  try {
    await updateDoc(docRef, sanitizeFirestoreData({
      status,
      respostaAdmin: respostaAdmin || null,
      atendidoPor: adminName || 'Administrador',
      atendidoEm: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  } catch (error: any) {
    console.error('Erro ao atualizar chamado:', error);
    throw new Error(`Falha ao atualizar chamado: ${error.message || error}`);
  }
}

export function subscribeChamados(
  onUpdate: (chamados: ChamadoTicket[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, CHAMADOS_COLLECTION));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ChamadoTicket[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChamadoTicket, 'id'>),
      }));
      // Sort in client by createdAt desc
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onUpdate(list);
    },
    (error) => {
      console.error('Erro no onSnapshot de chamados:', error);
      if (onError) onError(error);
    }
  );
}

export function subscribeMeusChamados(
  uid: string,
  onUpdate: (chamados: ChamadoTicket[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, CHAMADOS_COLLECTION), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ChamadoTicket[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChamadoTicket, 'id'>),
      }));
      // Sort in client by createdAt desc
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      onUpdate(list);
    },
    (error) => {
      console.error('Erro no onSnapshot de meus chamados:', error);
      if (onError) onError(error);
    }
  );
}
