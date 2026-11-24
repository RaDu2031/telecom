import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFirestoreMockModule,
  createFirebaseAuthMockModule,
  resetMockFirestore,
  seedDoc,
  getCollectionDocs,
  getAllNonEmptyCollections,
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
import { AmetaUser, TelecomSite, TssrRow, EricssonRow, EricssonEngineeringRow, ClaroEngenhariaRow } from '../types/telecom';
import { isClaroSiteRecord } from '../utils/spreadsheetUtils';

const makeAdminUser = (): AmetaUser => ({
  id: 'adm-1',
  uid: 'adm-1',
  name: 'Rafael Araujo',
  email: 'rafael.araujo@ametaservicos.com.br',
  role: 'ADM',
  situacao: 'dono',
  plataforma: 'AMBAS',
  assignedPlatform: 'BOTH',
  accessReleased: true,
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const makeSite = (overrides: Partial<TelecomSite>): TelecomSite => ({
  id: 'SITE_1',
  siteId: 'SITE_1',
  siteName: 'END_1',
  vendor: 'NOKIA',
  sheetName: 'Controle Geral',
  uf: 'SP',
  municipio: 'São Paulo',
  regional: 'SP',
  endereco: '',
  latitude: '',
  longitude: '',
  tipoInfra: 'Greenfield',
  tecnologias: '5G',
  bandas: '',
  gabineteBbu: 'SMP-1',
  modulosRf: '',
  versaoSw: '1',
  setores: '',
  azimutes: '',
  alturaAntena: '',
  tiltEletrico: '',
  transporteTx: 'LIBERADO',
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
  customFields: { 'SITE ID': 'SITE_1', 'Oc Site Pre': 'OC-1', EQUIPE: '' },
  ...overrides,
});

describe('Área A — Isolamento entre Plataformas (NOKIA / ERICSSON / CLARO_TIM)', () => {
  beforeEach(() => {
    resetMockFirestore();
    installMockLocalStorage();
  });

  it('A-01: Importar sites com vendor CLARO_TIM grava SOMENTE em claro_sites (nada em nokia_sites nem ericsson_*)', async () => {
    const claroRows = [
      makeSite({
        id: 'CLARO_1',
        siteId: 'MAALL01',
        vendor: 'CLARO_TIM',
        customFields: { 'SITE ID': 'MAALL01', CRQ: 'CRQ0001', 'Oc Site Pre': 'CLATCM01' },
      }),
      makeSite({
        id: 'CLARO_2',
        siteId: 'MASIS01',
        vendor: 'CLARO_TIM',
        customFields: { 'SITE ID': 'MASIS01', CRQ: 'CRQ0002', 'Oc Site Pre': 'CLATCM02' },
      }),
    ];

    const res = await dataService.importarSitesNokiaEmLote(claroRows, [], {}, {
      mode: 'append_only',
      sourceFileName: 'claro_sites.xlsx',
      vendor: 'CLARO_TIM',
    });

    expect(res.totalGravados).toBe(2);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES)).toHaveLength(2);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES)).toHaveLength(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.ERICSSON_SITES)).toHaveLength(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA)).toHaveLength(0);

    for (const d of getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES)) {
      expect(d.data.vendor).toBe('CLARO_TIM');
      expect(d.data.sheetName).toBe('Controle Geral');
    }
  });

  it('A-02: Importar sites NOKIA grava SOMENTE em nokia_sites (nada em claro_sites nem ericsson_*)', async () => {
    const nokiaRows = [
      makeSite({ id: 'NK_1', siteId: 'SPSP01', vendor: 'NOKIA' }),
      makeSite({ id: 'NK_2', siteId: 'SPSP02', vendor: 'NOKIA' }),
    ];

    const res = await dataService.importarSitesNokiaEmLote(nokiaRows, [], {}, {
      mode: 'append_only',
      sourceFileName: 'nokia_tim.xlsx',
      vendor: 'NOKIA',
    });

    expect(res.totalGravados).toBe(2);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES)).toHaveLength(2);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES)).toHaveLength(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.ERICSSON_SITES)).toHaveLength(0);
    for (const d of getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES)) {
      expect(d.data.vendor).toBe('NOKIA');
    }
  });

  it('A-03: Importar Ericsson Sites grava SOMENTE em ericsson_sites e Ericsson Engenharia SOMENTE em ericsson_engenharia', async () => {
    const ericRows: EricssonRow[] = [
      {
        id: 'PRAON04__PRPNG02',
        rowKey: 'CH1__REG1__PRAON04__PRPNG02',
        chaves: 'CH1',
        registro: 'REG1',
        state: 'PR',
        meta: 'Meta 1',
        siteIdA: 'PRAON04',
        idDetentoraA: '',
        siteIdB: 'PRPNG02',
        idDetentoraB: '',
        siteName: 'PRAON04-PRPNG02',
        statusA: 'Pendente',
        statusB: 'Pendente',
        cidadeA: 'Curitiba',
        cidadeB: 'Paranaguá',
        equipe: '',
        servico: 'TX',
        fields: { '01.21.Site ID A': 'PRAON04', '01.21.Site ID B': 'PRPNG02', EQUIPE: '' },
        siteAVistoriaStatus: 'Pendente',
        siteBVistoriaStatus: 'Pendente',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const ericEngRows: EricssonEngineeringRow[] = [
      {
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
      },
    ];

    await dataService.importarSitesEricssonEmLote(ericRows, [], {}, { mode: 'append_only' });
    await dataService.importarEricssonEngenhariaEmLote(ericEngRows, { mode: 'append_only' });

    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.ERICSSON_SITES)).toHaveLength(1);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.ERICSSON_ENGENHARIA)).toHaveLength(1);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES)).toHaveLength(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES)).toHaveLength(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_TSSR)).toHaveLength(0);
  });

  it('A-04: Importar Engenharia Nokia grava SOMENTE em nokia_tssr e Claro Engenharia SOMENTE em claro_engenharia', async () => {
    const tssrRows: TssrRow[] = [
      {
        id: 'TSSR_NK_1',
        rowKey: 'SPSP01__OC1',
        vendor: 'NOKIA',
        tabName: 'TSSR TIM Nokia',
        siteId: 'SPSP01',
        ocSitePre: 'OC1',
        enderecoId: 'END1',
        fields: { 'Site Id': 'SPSP01', 'Oc Site Pre': 'OC1', 'TSSR Status': 'Pendente' },
        vistoriaStatus: 'Pendente',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const claroEngRows: ClaroEngenhariaRow[] = [
      {
        id: 'CLARO_ENG_1',
        vendor: 'CLARO_TIM',
        siteId: 'MAALL01',
        sheetName: 'Engenharia',
        fields: { 'SITE ID': 'MAALL01', Status: 'Em produção' },
        updatedAt: new Date().toISOString(),
      },
    ];

    await dataService.importarTssrNokiaEmLote(tssrRows, [], { mode: 'append_only' });
    await dataService.importarEngenhariaClaroEmLote(claroEngRows, { sheetName: 'Engenharia' });

    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_TSSR)).toHaveLength(1);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA)).toHaveLength(1);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES)).toHaveLength(0);
    expect(getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES)).toHaveLength(0);
  });

  it('A-05: Listener onNokiaSites ignora documentos de nokia_sites com vendor CLARO_TIM e onClaroSites só emite claro_sites', () => {
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, 'nk_doc_1', makeSite({ id: 'nk_doc_1', siteId: 'TIM01', vendor: 'NOKIA' }));
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, 'leaked_claro', makeSite({ id: 'leaked_claro', siteId: 'CLA_LEAK', vendor: 'CLARO_TIM' }));
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_SITES, 'claro_doc_1', makeSite({ id: 'claro_doc_1', siteId: 'CLA01', vendor: 'CLARO_TIM' }));

    let receivedNokia: TelecomSite[] = [];
    let receivedClaro: TelecomSite[] = [];

    const unsub = dataService.observarColecoesPlataforma(makeAdminUser(), {
      onNokiaSites: (fetched) => {
        // Mesma guarda aplicada em App.tsx:664-666
        receivedNokia = fetched
          .filter((s) => s && s.vendor !== 'CLARO_TIM' && !isClaroSiteRecord(s))
          .map((s) => ({ ...s, vendor: 'NOKIA' }));
      },
      onClaroSites: (fetched) => {
        receivedClaro = fetched.map((s: any) => ({ ...s, vendor: 'CLARO_TIM', sheetName: 'Controle Geral' }));
      },
    });

    expect(receivedNokia.map((s) => s.siteId)).toEqual(['TIM01']);
    expect(receivedClaro.map((s) => s.siteId)).toEqual(['CLA01']);
    unsub();
  });

  it('A-06: Ferramenta moverRegistrosClaroDeNokiaSites move SOMENTE docs CLARO_TIM para claro_sites sem tocar em docs NOKIA', async () => {
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, 'nk_keep', makeSite({ id: 'nk_keep', siteId: 'TIM_KEEP', vendor: 'NOKIA' }));
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_SITES, 'claro_stuck', makeSite({ id: 'claro_stuck', siteId: 'CLA_MOVED', vendor: 'CLARO_TIM' }));
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_SITES, 'claro_stuck', makeSite({ id: 'claro_stuck', siteId: 'CLA_EXISTING', vendor: 'CLARO_TIM' }));

    const listed = await dataService.verificarRegistrosClaroEmNokiaSites();
    expect(listed.total).toBe(1);
    expect(listed.docs[0].id).toBe('claro_stuck');

    const res = await dataService.moverRegistrosClaroDeNokiaSites();
    expect(res.movidos).toBe(1);

    const remainingNokia = getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_SITES);
    expect(remainingNokia.map((d) => d.id)).toEqual(['nk_keep']);

    const claroDocs = getCollectionDocs(FIRESTORE_COLLECTIONS.CLARO_SITES);
    expect(claroDocs).toHaveLength(2);
    expect(claroDocs.some((d) => d.id === 'claro_stuck__movido_1' && d.data.siteId === 'CLA_MOVED')).toBe(true);
  });

  it('A-07: Atribuir demanda de executor (targetScope="executor") no vendor CLARO_TIM NÃO deve gravar na coleção nokia_tssr', async () => {
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_TSSR, 'SITE_X', {
      id: 'SITE_X',
      siteId: 'SITE_X',
      vendor: 'NOKIA',
      executor: '',
      fields: { 'Site Id': 'SITE_X', Executor: '' },
    });
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_ENGENHARIA, 'SITE_X', {
      id: 'SITE_X',
      siteId: 'SITE_X',
      fields: { 'SITE ID': 'SITE_X', Executor: '' },
    });

    await dataService.atribuirDemandaSites({
      siteTokens: ['SITE_X'],
      responsibleName: 'Executor Claro',
      vendor: 'CLARO_TIM',
      targetScope: 'executor',
    });

    const nokiaTssrDoc = getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_TSSR).find((d) => d.id === 'SITE_X');
    // Esperado: nokia_tssr permanece intocado quando vendor é CLARO_TIM
    expect(nokiaTssrDoc?.data.executor).toBe('');
  });

  it('A-08: limparTodasLinhasEquipeDupla com vendor CLARO_TIM NÃO deve alterar documentos de nokia_tssr', async () => {
    seedDoc(FIRESTORE_COLLECTIONS.CLARO_SITES, 'claro_1', makeSite({
      id: 'claro_1',
      siteId: 'CLA_1',
      vendor: 'CLARO_TIM',
      equipe: 'Magno / Mateus',
      responsavelDemand: 'Magno / Mateus',
      customFields: { 'SITE ID': 'CLA_1', EQUIPE: 'Magno / Mateus' },
    }));
    seedDoc(FIRESTORE_COLLECTIONS.NOKIA_TSSR, 'tssr_1', {
      id: 'tssr_1',
      siteId: 'NK_1',
      vendor: 'NOKIA',
      equipe: 'Magno / Mateus',
      fields: { 'Site Id': 'NK_1', EQUIPE: 'Magno / Mateus' },
    });

    await dataService.limparTodasLinhasEquipeDupla({
      duplaName: 'Magno / Mateus',
      vendor: 'CLARO_TIM',
    });

    const tssrAfter = getCollectionDocs(FIRESTORE_COLLECTIONS.NOKIA_TSSR).find((d) => d.id === 'tssr_1');
    // Esperado: nokia_tssr NÃO deve ser alterado por ação da plataforma CLARO_TIM
    expect(tssrAfter?.data.equipe).toBe('Magno / Mateus');
  });

  it('A-09: demandaSharedService.getRegisteredUsersForDemanda no vendor CLARO_TIM inclui usuários da plataforma NOKIA/AMBAS', () => {
    const users: AmetaUser[] = [
      {
        id: 'u1',
        uid: 'u1',
        name: 'Vistoriador Nokia',
        email: 'vist.nokia@ametaservicos.com.br',
        role: 'Vistoriador',
        situacao: 'ativo',
        plataforma: 'NOKIA',
        accessReleased: true,
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'u2',
        uid: 'u2',
        name: 'Vistoriador Ambas',
        email: 'vist.ambas@ametaservicos.com.br',
        role: 'Vistoriador',
        situacao: 'ativo',
        plataforma: 'AMBAS',
        accessReleased: true,
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const list = demandaSharedService.getRegisteredUsersForDemanda(users, [], 'CLARO_TIM');
    // Usuários da plataforma NOKIA têm acesso à Claro, portanto deveriam aparecer no escopo CLARO_TIM
    expect(list.map((u) => u.email)).toContain('vist.nokia@ametaservicos.com.br');
    expect(list.map((u) => u.email)).toContain('vist.ambas@ametaservicos.com.br');
  });

  it('A-10: Equipes excluídas na Claro NÃO devem excluir a mesma dupla na plataforma NOKIA (compartilhamento indevido de excludedDuplasNokia)', async () => {
    await dataService.adicionarEquipeExcluida({ duplaName: 'Dupla Exclusiva Claro', vendor: 'CLARO_TIM' });
    const cfg = getCollectionDocs('duplas_config').find((d) => d.id === 'main')?.data;
    // Esperado: Claro ter lista própria (ex.: excludedDuplasClaro) sem poluir excludedDuplasNokia
    expect(cfg?.excludedDuplasNokia || []).not.toContain('Dupla Exclusiva Claro');
  });

  it('A-11: Colisão de coleções — importarSitesNokiaEmLote não cria nenhuma coleção inesperada além da coleção alvo e historico_importacoes', async () => {
    await dataService.importarSitesNokiaEmLote([makeSite({ id: 'C1', siteId: 'C1', vendor: 'CLARO_TIM' })], [], {}, {
      mode: 'append_only',
      vendor: 'CLARO_TIM',
    });
    const cols = getAllNonEmptyCollections();
    expect(cols).toEqual([FIRESTORE_COLLECTIONS.CLARO_SITES, FIRESTORE_COLLECTIONS.HISTORICO_IMPORTACOES].sort());
  });
});
