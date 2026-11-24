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
import { demandaSharedService } from '../services/demandaSharedService';
import { getEquipeSite, temEquipeDemandadaSite, doesSiteMatchEquipe } from '../utils/spreadsheetUtils';
import {
  TelecomSite,
  EricssonRow,
  EricssonEngineeringRow,
  TssrRow,
  AmetaUser,
} from '../types/telecom';

function seedRegisteredUsers() {
  const users: AmetaUser[] = [
    {
      id: 'u_vist_1',
      uid: 'u_vist_1',
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
      id: 'u_vist_2',
      uid: 'u_vist_2',
      name: 'Diego Lima',
      email: 'diego@ametaservicos.com.br',
      role: 'Vistoriador',
      situacao: 'ativo',
      plataforma: 'AMBAS',
      equipe: 'Diego / Vagner',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'u_exec_1',
      uid: 'u_exec_1',
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
      id: 'u_exec_2',
      uid: 'u_exec_2',
      name: 'Carlos Eduardo',
      email: 'carlos@ametaservicos.com.br',
      role: 'Executor',
      situacao: 'ativo',
      plataforma: 'AMBAS',
      equipe: 'Carlos Eduardo',
      accessReleased: true,
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  for (const u of users) {
    seedDoc(FIRESTORE_COLLECTIONS.USUARIOS, u.id, u);
  }
}

const makeNokiaSite = (id: string, siteId: string, vendor: 'NOKIA' | 'CLARO_TIM' = 'NOKIA'): TelecomSite => ({
  id,
  siteId,
  siteName: `${siteId}_END`,
  vendor,
  sheetName: 'Controle Geral',
  uf: 'SP',
  municipio: 'SP',
  regional: 'SP',
  endereco: '',
  latitude: '',
  longitude: '',
  tipoInfra: '',
  tecnologias: '5G',
  bandas: '',
  gabineteBbu: '',
  modulosRf: '',
  versaoSw: '',
  setores: '',
  azimutes: '',
  alturaAntena: '',
  tiltEletrico: '',
  transporteTx: '',
  ipGerencia: '',
  vlanOm: '',
  energiaRetificadora: '',
  status: 'Vistoria - A Executar',
  progressoRollout: 0,
  dataIntegracao: '',
  dataAtivacao: '',
  responsavelCampo: '',
  equipeParceira: '',
  ordemServico: 'OC-1',
  alarmesAtivos: '',
  observacoes: '',
  updatedAt: new Date().toISOString(),
  updatedBy: 'qa',
  customFields: { 'SITE ID': siteId, EQUIPE: '' },
});

const makeEricssonSite = (id: string, siteIdA: string, siteIdB: string): EricssonRow => ({
  id,
  rowKey: `CH__REG__${siteIdA}__${siteIdB}`,
  chaves: 'CH',
  registro: 'REG',
  state: 'PR',
  meta: 'Meta 1',
  siteIdA,
  idDetentoraA: '',
  siteIdB,
  idDetentoraB: '',
  siteName: `${siteIdA}-${siteIdB}`,
  statusA: 'Pendente',
  statusB: 'Pendente',
  cidadeA: 'Curitiba',
  cidadeB: 'Paranaguá',
  equipe: '',
  servico: 'TX',
  fields: { '01.21.Site ID A': siteIdA, '01.21.Site ID B': siteIdB, EQUIPE: '' },
  siteAVistoriaStatus: 'Pendente',
  siteBVistoriaStatus: 'Pendente',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('Área C — Demandas e Responsáveis', () => {
  beforeEach(() => {
    resetMockFirestore();
    installMockLocalStorage();
    seedRegisteredUsers();
  });

  it('C-01: EQUIPE vazia / "Sem Dupla" nos Sites determina corretamente se está demandado', () => {
    const emptySite = makeNokiaSite('s1', 'S1');
    expect(getEquipeSite(emptySite)).toBe('');
    expect(temEquipeDemandadaSite(emptySite)).toBe(false);
    expect(doesSiteMatchEquipe(emptySite, 'Sem Dupla')).toBe(true);

    const withTeam = makeNokiaSite('s2', 'S2');
    withTeam.customFields = { 'SITE ID': 'S2', EQUIPE: 'Magno / Mateus' };
    expect(getEquipeSite(withTeam)).toBe('Magno / Mateus');
    expect(temEquipeDemandadaSite(withTeam)).toBe(true);
    expect(doesSiteMatchEquipe(withTeam, 'Sem Dupla')).toBe(false);
    expect(doesSiteMatchEquipe(withTeam, 'Magno / Mateus')).toBe(true);

    // Mesmo que responsavelDemand esteja preenchido, se EQUIPE e equipe estão vazios, NÃO está demandado nos Sites
    const legacyOnly = makeNokiaSite('s3', 'S3');
    legacyOnly.responsavelDemand = 'Antigo';
    legacyOnly.customFields = { 'SITE ID': 'S3', EQUIPE: '   ' };
    expect(temEquipeDemandadaSite(legacyOnly)).toBe(false);
  });

  it('C-02: Atribuir demanda a Vistoriador (Sites Nokia e Claro) e Executor (TSSR Nokia) grava campos e cria acionamentos', async () => {
    const nkSite = makeNokiaSite('Controle_Geral__SPSP01', 'SPSP01', 'NOKIA');
    const claroSite = makeNokiaSite('Controle_Geral__MAALL01', 'MAALL01', 'CLARO_TIM');
    const tssrRow: TssrRow = {
      id: 'TSSR_SPSP01',
      rowKey: 'SPSP01__OC1',
      vendor: 'NOKIA',
      tabName: 'TSSR TIM Nokia',
      siteId: 'SPSP01',
      ocSitePre: 'OC1',
      enderecoId: 'END1',
      fields: { 'Site Id': 'SPSP01', Executor: '' },
      vistoriaStatus: 'Pendente',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, nkSite.id, nkSite);
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_SITES, claroSite.id, claroSite);
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_TSSR, tssrRow.id, tssrRow);

    await demandaSharedService.atribuirDemanda({
      siteTokens: [nkSite.id],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'NOKIA',
      currentSites: [nkSite],
      targetScope: 'equipe',
    });

    await demandaSharedService.atribuirDemanda({
      siteTokens: [claroSite.id],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'CLARO_TIM',
      currentSites: [claroSite],
      targetScope: 'equipe',
    });

    await demandaSharedService.atribuirDemanda({
      siteTokens: [tssrRow.id],
      responsibleName: 'Ana Paula',
      linkedEmails: ['anapaula@ametaservicos.com.br'],
      vendor: 'NOKIA',
      currentSites: [nkSite],
      currentTssrRows: [tssrRow],
      targetScope: 'executor',
    });

    const nkAfter = getDocData(FIRESTORE_COLLECTIONS.NOKIA_SITES, nkSite.id);
    expect(nkAfter?.equipe).toBe('Magno / Mateus');
    expect(nkAfter?.responsaveisEmails).toEqual(['magno@ametaservicos.com.br']);

    const claroAfter = getDocData(FIRESTORE_COLLECTIONS.CLARO_SITES, claroSite.id);
    expect(claroAfter?.equipe).toBe('Magno / Mateus');

    const tssrAfter = getDocData(FIRESTORE_COLLECTIONS.NOKIA_TSSR, tssrRow.id);
    expect(tssrAfter?.executor).toBe('Ana Paula');

    const acionamentos = getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS);
    expect(acionamentos).toHaveLength(3);
    expect(acionamentos.filter((a) => a.data.tipoDestinatario === 'VISTORIA')).toHaveLength(2);
    expect(acionamentos.filter((a) => a.data.tipoDestinatario === 'EXECUTOR')).toHaveLength(1);
  });

  it('C-03: Remover demanda (Nokia, Claro, Ericsson) limpa responsável/equipe/uids/emails e cancela acionamento — inclusive Site ID com "__" (PRAON04__PRPNG02) e IDs com sufixo', async () => {
    const nkSuffixed = makeNokiaSite('Controle_Geral__SPSP01__IMP1_2', 'SPSP01', 'NOKIA');
    const claroSuffixed = makeNokiaSite('Controle_Geral__MAALL01__IMP2_5', 'MAALL01', 'CLARO_TIM');
    const ericDoubleUnder = makeEricssonSite('PRAON04__PRPNG02', 'PRAON04', 'PRPNG02');
    const ericSuffixed = makeEricssonSite('PRAON04__PRPNG02__IMP9_12', 'PRAON04', 'PRPNG02');

    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, nkSuffixed.id, nkSuffixed);
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_SITES, claroSuffixed.id, claroSuffixed);
    seedDoc(FIRESTORE_COLLECTIONS.ERICSSON_SITES, ericDoubleUnder.id, ericDoubleUnder);
    seedDoc(FIRESTORE_COLLECTIONS.ERICSSON_SITES, ericSuffixed.id, ericSuffixed);

    // Atribuir todos
    const resNkAssign = await demandaSharedService.atribuirDemanda({
      siteTokens: [nkSuffixed.id],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'NOKIA',
      currentSites: [nkSuffixed],
      targetScope: 'equipe',
    });
    const resClAssign = await demandaSharedService.atribuirDemanda({
      siteTokens: [claroSuffixed.id],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'CLARO_TIM',
      currentSites: [claroSuffixed],
      targetScope: 'equipe',
    });
    const resErAssign = await demandaSharedService.atribuirDemanda({
      siteTokens: [ericDoubleUnder.id, ericSuffixed.id],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'ERICSSON',
      currentSites: [],
      currentEricssonRows: [ericDoubleUnder, ericSuffixed],
      targetScope: 'equipe',
    });

    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS)).toHaveLength(4);

    // Remover todos
    await demandaSharedService.removerDemanda({
      siteTokens: [nkSuffixed.id],
      vendor: 'NOKIA',
      currentSites: resNkAssign.updatedSites,
      targetScope: 'equipe',
    });
    await demandaSharedService.removerDemanda({
      siteTokens: [claroSuffixed.id],
      vendor: 'CLARO_TIM',
      currentSites: resClAssign.updatedSites,
      targetScope: 'equipe',
    });
    await demandaSharedService.removerDemanda({
      siteTokens: [ericDoubleUnder.id, ericSuffixed.id],
      vendor: 'ERICSSON',
      currentSites: [],
      currentEricssonRows: resErAssign.updatedEricssonRows,
      targetScope: 'equipe',
    });

    // Verificar limpeza completa de campos
    const nkClean = getDocData(FIRESTORE_COLLECTIONS.NOKIA_SITES, nkSuffixed.id);
    expect(nkClean?.responsavelDemand).toBe('');
    expect(nkClean?.equipe).toBe('');
    expect(nkClean?.responsaveisEmails).toEqual([]);
    expect(nkClean?.responsaveisUids).toEqual([]);

    const clClean = getDocData(FIRESTORE_COLLECTIONS.CLARO_SITES, claroSuffixed.id);
    expect(clClean?.responsavelDemand).toBe('');
    expect(clClean?.equipe).toBe('');
    expect(clClean?.responsaveisEmails).toEqual([]);
    expect(clClean?.responsaveisUids).toEqual([]);

    const erClean1 = getDocData(FIRESTORE_COLLECTIONS.ERICSSON_SITES, ericDoubleUnder.id);
    expect(erClean1?.responsavelDemand).toBe('');
    expect(erClean1?.equipe).toBe('');
    expect(erClean1?.responsaveisEmails).toEqual([]);

    // Verificar que TODOS os 4 acionamentos foram cancelados com destinatariosEmails vazio
    const acs = getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS);
    expect(acs).toHaveLength(4);
    for (const ac of acs) {
      expect(ac.data.status).toBe('Cancelado');
      expect(ac.data.destinatariosEmails).toEqual([]);
    }
  });

  it('C-04: Reatribuir demanda para outro executor faz o acionamento deixar de ficar ativo para o anterior', async () => {
    const engRow: EricssonEngineeringRow = {
      id: 'eric_eng_1',
      rowKey: 'INT1__WR__1',
      rowIndex: 1,
      intervencaoClaro: 'INT1',
      siteIdA: 'PRAON04',
      siteIdB: 'PRPNG02',
      statusA: 'Em produção',
      statusB: 'Em produção',
      tipoDoc: 'WR',
      status: 'Em produção',
      regional: 'SUL',
      tipoSite: 'Greenfield',
      executor: '',
      meta: 'Meta 1',
      fields: { 'Intervencao Claro': 'INT1', 'Tipo doc': 'WR', Status: 'Em produção' },
      siteAVistoriaStatus: 'Pendente',
      updatedAt: new Date().toISOString(),
    };
    seedDoc(FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA, engRow.id, engRow);

    await dataService.atribuirDemandaSites({
      siteTokens: [engRow.id],
      responsibleName: 'Ana Paula',
      linkedEmails: ['anapaula@ametaservicos.com.br'],
      vendor: 'ERICSSON',
      targetScope: 'executor',
    });

    await dataService.atribuirDemandaSites({
      siteTokens: [engRow.id],
      responsibleName: 'Carlos Eduardo',
      linkedEmails: ['carlos@ametaservicos.com.br'],
      vendor: 'ERICSSON',
      targetScope: 'executor',
    });

    const acs = getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS);
    const activeForOld = acs.filter(
      (a) =>
        a.data.status !== 'Cancelado' &&
        Array.isArray(a.data.destinatariosEmails) &&
        a.data.destinatariosEmails.includes('anapaula@ametaservicos.com.br')
    );
    const activeForNew = acs.filter(
      (a) =>
        a.data.status === 'Aguardando aceite' &&
        Array.isArray(a.data.destinatariosEmails) &&
        a.data.destinatariosEmails.includes('carlos@ametaservicos.com.br')
    );

    expect(activeForOld).toHaveLength(0);
    expect(activeForNew).toHaveLength(1);
    expect(activeForNew[0].data.equipe).toBe('Carlos Eduardo');
  });

  it('C-05: targetScope "executor" vs "equipe" (vistoria) — remover executor NUNCA cancela acionamento de vistoria e vice-versa', async () => {
    const nkSite = makeNokiaSite('SPSP99', 'SPSP99', 'NOKIA');
    const tssrRow: TssrRow = {
      id: 'SPSP99',
      rowKey: 'SPSP99__OC99',
      vendor: 'NOKIA',
      tabName: 'TSSR TIM Nokia',
      siteId: 'SPSP99',
      ocSitePre: 'OC99',
      enderecoId: 'END99',
      fields: { 'Site Id': 'SPSP99' },
      vistoriaStatus: 'Pendente',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, nkSite.id, nkSite);
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_TSSR, tssrRow.id, tssrRow);

    await dataService.atribuirDemandaSites({
      siteTokens: ['SPSP99'],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'NOKIA',
      targetScope: 'equipe',
    });
    await dataService.atribuirDemandaSites({
      siteTokens: ['SPSP99'],
      responsibleName: 'Ana Paula',
      linkedEmails: ['anapaula@ametaservicos.com.br'],
      vendor: 'NOKIA',
      targetScope: 'executor',
    });

    // Remover APENAS executor
    await dataService.desvincularDemandaSites({
      siteTokens: ['SPSP99'],
      vendor: 'NOKIA',
      targetScope: 'executor',
    });

    const acs = getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS);
    const vistoriaAc = acs.find((a) => a.data.tipoDestinatario === 'VISTORIA');
    const executorAc = acs.find((a) => a.data.tipoDestinatario === 'EXECUTOR');

    expect(executorAc?.data.status).toBe('Cancelado');
    expect(vistoriaAc?.data.status).toBe('Aguardando aceite');
    expect(vistoriaAc?.data.destinatariosEmails).toEqual(['magno@ametaservicos.com.br']);
  });

  it('C-06: Funções de equipes/duplas — vincular/desvincular e-mails, adicionar/remover equipe excluída e limparTodasLinhasEquipeDupla', async () => {
    await dataService.vincularEmailsDupla({
      duplaName: 'Magno / Mateus',
      emails: ['magno@ametaservicos.com.br'],
      vendor: 'NOKIA',
    });
    let cfg = getDocData('duplas_config', 'main');
    expect(cfg?.duplaEmailsMap?.['Magno / Mateus']).toEqual(['magno@ametaservicos.com.br']);

    await dataService.desvincularEmailsDupla({
      duplaName: 'Magno / Mateus',
      vendor: 'NOKIA',
    });
    cfg = getDocData('duplas_config', 'main');
    expect(cfg?.duplaEmailsMap?.['Magno / Mateus']).toBeUndefined();

    await dataService.adicionarEquipeExcluida({ duplaName: 'Dupla Removida', vendor: 'ERICSSON' });
    cfg = getDocData('duplas_config', 'main');
    expect(cfg?.excludedDuplasEricsson).toContain('Dupla Removida');

    await dataService.removerEquipeExcluida({ duplaName: 'Dupla Removida', vendor: 'ERICSSON' });
    cfg = getDocData('duplas_config', 'main');
    expect(cfg?.excludedDuplasEricsson).not.toContain('Dupla Removida');
  });

  it('C-07: limparTodasLinhasEquipeDupla no Nokia (usado ao excluir dupla / zerar equipe) também deve cancelar os acionamentos da dupla', async () => {
    const nkSite = makeNokiaSite('SPSP77', 'SPSP77', 'NOKIA');
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, nkSite.id, nkSite);

    await dataService.atribuirDemandaSites({
      siteTokens: ['SPSP77'],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'NOKIA',
      targetScope: 'equipe',
    });

    await dataService.limparTodasLinhasEquipeDupla({
      duplaName: 'Magno / Mateus',
      vendor: 'NOKIA',
    });

    const ac = getCollectionDocs(FIRESTORE_COLLECTIONS.ACIONAMENTOS)[0];
    // Esperado: acionamento cancelado ao limpar todas as linhas da equipe no Nokia
    expect(ac?.data.status).toBe('Cancelado');
  });

  it('C-08: atribuirDemanda com allowTransfer=false em site já atribuído não deve reportar count inflado', async () => {
    const assignedSite = makeNokiaSite('SPSP88', 'SPSP88', 'NOKIA');
    assignedSite.equipe = 'Diego / Vagner';
    assignedSite.responsavelDemand = 'Diego / Vagner';
    assignedSite.customFields = { 'SITE ID': 'SPSP88', EQUIPE: 'Diego / Vagner' };
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, assignedSite.id, assignedSite);

    const res = await demandaSharedService.atribuirDemanda({
      siteTokens: ['SPSP88'],
      responsibleName: 'Magno / Mateus',
      linkedEmails: ['magno@ametaservicos.com.br'],
      vendor: 'NOKIA',
      currentSites: [assignedSite],
      allowTransfer: false,
      targetScope: 'equipe',
    });

    // Site já tinha equipe e allowTransfer=false -> 0 sites deveriam ser transferidos/contados
    expect(res.count).toBe(0);
  });

  it('C-09: desvincularDemandaSites no Nokia/Claro com >500 documentos respeita o limite de 500 ops por writeBatch do Firestore', async () => {
    resetMockFirestore({ enforce500Limit: true });
    for (let i = 0; i < 505; i++) {
      const id = `SITE_B_${i}`;
      seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, id, {
        ...makeNokiaSite(id, id, 'NOKIA'),
        equipe: 'Magno / Mateus',
        responsavelDemand: 'Magno / Mateus',
      });
    }
    const tokens = Array.from({ length: 505 }, (_, i) => `SITE_B_${i}`);
    await expect(
      dataService.desvincularDemandaSites({
        siteTokens: tokens,
        vendor: 'NOKIA',
        targetScope: 'equipe',
      })
    ).resolves.toMatchObject({ updatedCount: 505 });
  });
});
