import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFirestoreMockModule,
  createFirebaseAuthMockModule,
  resetMockFirestore,
  seedDoc,
  getDocData,
  getCollectionDocs,
  installMockLocalStorage,
} from './mockFirestore';

vi.mock('firebase/firestore', () => createFirestoreMockModule());
vi.mock('firebase/auth', () => createFirebaseAuthMockModule());
vi.mock('../lib/firebase', () => ({
  db: { __mockDb: true },
  auth: { currentUser: { uid: 'adm-1', email: 'rafael.araujo@ametaservicos.com.br' } },
  storage: {},
}));

import { dataService, FIRESTORE_COLLECTIONS } from '../services/dataService';
import { buildAcionamentoId, AmetaUser } from '../types/telecom';

function seedUsersForAcionamentos() {
  const users: AmetaUser[] = [
    {
      id: 'u_exec',
      uid: 'u_exec',
      name: 'Ana Paula',
      email: 'anapaula@ametaservicos.com.br',
      role: 'Executor',
      situacao: 'ativo',
      plataforma: 'AMBAS',
      equipe: 'Ana Paula',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'u_vist',
      uid: 'u_vist',
      name: 'Magno Silva',
      email: 'magno@ametaservicos.com.br',
      role: 'Vistoriador',
      situacao: 'ativo',
      plataforma: 'AMBAS',
      equipe: 'Magno / Mateus',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'u_coord_geral',
      uid: 'u_coord_geral',
      name: 'Coord Geral',
      email: 'coordgeral@ametaservicos.com.br',
      role: 'Coordenador Geral',
      situacao: 'ativo',
      plataforma: 'AMBAS',
      equipe: 'Magno / Mateus',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'u_coord_eng',
      uid: 'u_coord_eng',
      name: 'Coord Eng',
      email: 'coordeng@ametaservicos.com.br',
      role: 'Coordenador Engenharia',
      situacao: 'ativo',
      plataforma: 'AMBAS',
      equipe: 'Ana Paula',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'u_adm',
      uid: 'u_adm',
      name: 'Rafael Araujo',
      email: 'rafael.araujo@ametaservicos.com.br',
      role: 'ADM',
      situacao: 'dono',
      plataforma: 'AMBAS',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  for (const u of users) {
    seedDoc(FIRESTORE_COLLECTIONS.USUARIOS, u.id, u);
  }
}

describe('Área D — Acionamentos (integração com sistema novo)', () => {
  beforeEach(() => {
    resetMockFirestore();
    installMockLocalStorage();
    seedUsersForAcionamentos();
  });

  it('D-01: buildAcionamentoId gera ID determinístico para IDs simples e distintos por vendor/tipo', () => {
    expect(buildAcionamentoId('NOKIA', 'SPSP01', 'VISTORIA')).toBe('NOKIA_SPSP01_VISTORIA');
    expect(buildAcionamentoId('NOKIA', 'SPSP01', 'EXECUTOR')).toBe('NOKIA_SPSP01_EXECUTOR');
    expect(buildAcionamentoId('CLARO_TIM', 'MAALL01', 'VISTORIA')).toBe('CLARO_TIM_MAALL01_VISTORIA');
    expect(buildAcionamentoId('ERICSSON', 'PRAON04', 'VISTORIA')).toBe('ERICSSON_PRAON04_VISTORIA');
  });

  it('D-02: buildAcionamentoId com registroId que contém "__" (ex.: PRAON04__PRPNG02 ou Controle_Geral__SPSP01) não deve duplicar o siteId no sufixo', () => {
    // Em Ericsson, registroId costuma ser "PRAON04__PRPNG02" e siteId pode ser "PRAON04__PRPNG02"
    const idEricSame = buildAcionamentoId('ERICSSON', 'PRAON04__PRPNG02', 'VISTORIA', 'PRAON04__PRPNG02');
    expect(idEricSame).toBe('ERICSSON_PRAON04__PRPNG02_VISTORIA');

    // Em Nokia, registroId costuma ser "Controle_Geral__SPSP01" e siteId "SPSP01" -> sufixo não deveria repetir SPSP01
    const idNokiaSheet = buildAcionamentoId('NOKIA', 'SPSP01', 'VISTORIA', 'Controle_Geral__SPSP01');
    expect(idNokiaSheet).not.toContain('SPSP01__SPSP01');
  });

  it('D-03: salvarOuAtualizarAcionamento — criação de novo acionamento com status Pendente, protocolo e destinatariosEmails', async () => {
    const ac = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP01',
      registroId: 'SPSP01',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-13T10:00:00.000Z',
      dataDemanda: '13/10/2026',
    });

    expect(ac.id).toBe('NOKIA_SPSP01_VISTORIA');
    expect(ac.status).toBe('Aguardando aceite');
    expect(ac.protocolo).toMatch(/^AC-NOK-[A-Z0-9_-]+-\d{4}$/);
    expect(ac.destinatariosEmails).toEqual(['magno@ametaservicos.com.br']);
    expect(ac.historico).toHaveLength(1);

    const saved = getDocData(FIRESTORE_COLLECTIONS.ACIONAMENTOS, ac.id);
    expect(saved?.status).toBe('Aguardando aceite');
  });

  it('D-04: salvarOuAtualizarAcionamento — acionamento Recusado reenviado volta para Pendente mantendo protocolo', async () => {
    const created = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP02',
      registroId: 'SPSP02',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-13T10:00:00.000Z',
    });

    // Simular recusa pelo vistoriador
    seedDoc(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id, {
      ...getDocData(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id),
      status: 'Recusado',
      motivoRecusa: 'Sem chave no local',
    });

    const resent = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP02',
      registroId: 'SPSP02',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-14T10:00:00.000Z',
    });

    expect(resent.status).toBe('Aguardando aceite');
    expect(resent.protocolo).toBe(created.protocolo);
    expect(resent.motivoRecusa).toBe('');
    expect(resent.historico.some((h) => h.acao.toLowerCase().includes('reenviad'))).toBe(true);
  });

  it('D-05: salvarOuAtualizarAcionamento — mesma equipe em andamento preserva status Aceito e atualiza destinatariosEmails se alterados', async () => {
    const created = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP03',
      registroId: 'SPSP03',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-13T10:00:00.000Z',
    });

    seedDoc(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id, {
      ...getDocData(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id),
      status: 'Aceito',
    });

    // Mesma equipe, mesmo e-mail -> retorna sem resetar status
    const same = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP03',
      registroId: 'SPSP03',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-14T10:00:00.000Z',
    });
    expect(same.status).toBe('Aceito');

    // Mesma equipe, novo e-mail adicionado -> preserva Aceito e atualiza destinatariosEmails
    const updatedEmails = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP03',
      registroId: 'SPSP03',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br', 'mateus@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-14T11:00:00.000Z',
    });
    expect(updatedEmails.status).toBe('Aceito');
    expect(updatedEmails.destinatariosEmails).toEqual(['magno@ametaservicos.com.br', 'mateus@ametaservicos.com.br']);
  });

  it('D-06: salvarOuAtualizarAcionamento — reatribuição para outra equipe volta status para Pendente e substitui destinatariosEmails', async () => {
    const created = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP04',
      registroId: 'SPSP04',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-13T10:00:00.000Z',
    });

    seedDoc(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id, {
      ...getDocData(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id),
      status: 'Aceito',
    });

    const reassigned = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP04',
      registroId: 'SPSP04',
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Diego / Vagner',
      destinatariosEmails: ['diego@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-15T10:00:00.000Z',
    });

    expect(reassigned.status).toBe('Aguardando aceite');
    expect(reassigned.equipe).toBe('Diego / Vagner');
    expect(reassigned.destinatariosEmails).toEqual(['diego@ametaservicos.com.br']);
  });

  it('D-07: cancelarAcionamento muda status para Cancelado, limpa destinatariosEmails e registra histórico', async () => {
    const created = await dataService.salvarOuAtualizarAcionamento({
      siteId: 'SPSP05',
      registroId: 'SPSP05',
      vendor: 'CLARO_TIM',
      tipoDestinatario: 'VISTORIA',
      equipe: 'Magno / Mateus',
      destinatariosEmails: ['magno@ametaservicos.com.br'],
      demandadoPorNome: 'Rafael',
      demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
      demandadoEm: '2026-10-13T10:00:00.000Z',
    });

    await dataService.cancelarAcionamento(created.id, { motivo: 'Cancelado em teste' });
    const after = getDocData(FIRESTORE_COLLECTIONS.ACIONAMENTOS, created.id);
    expect(after?.status).toBe('Cancelado');
    expect(after?.destinatariosEmails).toEqual([]);
    expect(after?.historico.some((h: any) => h.acao.toLowerCase().includes('cancelad'))).toBe(true);
  });

  it('D-08: resolverDestinatariosEmails filtra por role (Executor vs Vistoriador), exclui coordenação/ADM e e-mails não cadastrados', async () => {
    const vistEmails = await dataService.resolverDestinatariosEmails({
      responsibleName: 'Magno / Mateus',
      linkedEmails: [
        'magno@ametaservicos.com.br',       // Vistoriador (OK)
        'anapaula@ametaservicos.com.br',    // Executor (excluir para VISTORIA)
        'coordgeral@ametaservicos.com.br',  // Coordenador Geral (excluir)
        'rafael.araujo@ametaservicos.com.br', // ADM (excluir)
        'desconhecido@externo.com',         // Não cadastrado (excluir)
      ],
      vendor: 'NOKIA',
      tipoDestinatario: 'VISTORIA',
    });
    expect(vistEmails).toEqual(['magno@ametaservicos.com.br']);

    const execEmails = await dataService.resolverDestinatariosEmails({
      responsibleName: 'Ana Paula',
      linkedEmails: [
        'anapaula@ametaservicos.com.br',    // Executor (OK)
        'magno@ametaservicos.com.br',       // Vistoriador (excluir para EXECUTOR)
        'coordeng@ametaservicos.com.br',    // Coordenador Engenharia (excluir)
        'naoexiste@ametaservicos.com.br',   // Não cadastrado (excluir)
      ],
      vendor: 'NOKIA',
      tipoDestinatario: 'EXECUTOR',
    });
    expect(execEmails).toEqual(['anapaula@ametaservicos.com.br']);
  });

  it('D-09: Geração de protocolo em salvarOuAtualizarAcionamento garante unicidade (sem colisão)', async () => {
    const origRandom = Math.random;
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // força mesmo número aleatório para testar proteção contra colisão
    try {
      const ac1 = await dataService.salvarOuAtualizarAcionamento({
        siteId: 'SITE_A_12345678',
        registroId: 'SITE_A_12345678',
        vendor: 'NOKIA',
        tipoDestinatario: 'VISTORIA',
        equipe: 'Magno / Mateus',
        destinatariosEmails: ['magno@ametaservicos.com.br'],
        demandadoPorNome: 'Rafael',
        demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
        demandadoEm: '2026-10-13T10:00:00.000Z',
      });
      const ac2 = await dataService.salvarOuAtualizarAcionamento({
        siteId: 'SITE_B_12345678',
        registroId: 'SITE_B_12345678',
        vendor: 'NOKIA',
        tipoDestinatario: 'VISTORIA',
        equipe: 'Magno / Mateus',
        destinatariosEmails: ['magno@ametaservicos.com.br'],
        demandadoPorNome: 'Rafael',
        demandadoPorEmail: 'rafael.araujo@ametaservicos.com.br',
        demandadoEm: '2026-10-13T10:00:00.000Z',
      });
      // Esperado: protocolos únicos mesmo quando últimos 8 chars do siteId e Math.random colidem
      expect(ac1.protocolo).not.toBe(ac2.protocolo);
    } finally {
      vi.restoreAllMocks();
      Math.random = origRandom;
    }
  });

  it('D-10: tipoDestinatario correto por escopo (Sites -> VISTORIA, Engenharia -> EXECUTOR)', async () => {
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_SITES, 'C1', {
      id: 'C1',
      siteId: 'C1',
      vendor: 'CLARO_TIM',
      customFields: { 'SITE ID': 'C1' },
    });
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_TSSR, 'T1', {
      id: 'T1',
      siteId: 'T1',
      vendor: 'NOKIA',
      fields: { 'Site Id': 'T1' },
    });

    await dataService.atribuirDemandaSites({
      siteTokens: ['C1'],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'CLARO_TIM',
      targetScope: 'equipe',
    });
    await dataService.atribuirDemandaSites({
      siteTokens: ['T1'],
      responsibleName: 'Ana Paula',
      linkedEmails: ['anapaula@ametaservicos.com.br'],
      vendor: 'NOKIA',
      targetScope: 'executor',
    });

    const acs = getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS);
    expect(acs.find((a) => a.data.siteId === 'C1')?.data.tipoDestinatario).toBe('VISTORIA');
    expect(acs.find((a) => a.data.siteId === 'T1')?.data.tipoDestinatario).toBe('EXECUTOR');
  });
});
