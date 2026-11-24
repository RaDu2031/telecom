import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createFirestoreMockModule,
  createFirebaseAuthMockModule,
  resetMockFirestore,
  installMockLocalStorage,
} from './mockFirestore';

vi.mock('firebase/firestore', () => createFirestoreMockModule());
vi.mock('firebase/auth', () => createFirebaseAuthMockModule());
vi.mock('../lib/firebase', () => ({
  db: { __mockDb: true },
  auth: { currentUser: { uid: 'adm-1', email: 'rafael.araujo@ametaservicos.com.br' } },
  storage: {},
}));

import {
  canUserAccessVendor,
  normalizeUserRole,
  hasFullSpreadsheetAccess,
  isGestorRole,
  isEngineeringCoordinatorRole,
  TSSR_EXECUTOR_VISIBLE_COLUMNS,
  ERICSSON_EXECUTOR_VISIBLE_COLUMNS,
  AmetaUser,
  TelecomSite,
  EricssonEngineeringRow,
} from '../types/telecom';
import {
  buildExportRows,
  formatExcelCellValue,
  getCellValueForColumn,
  syncSiteColumnUpdate,
} from '../utils/spreadsheetUtils';
import {
  isEricssonRowReproved,
  computeEricssonConsolidatedStats,
  isEricssonRowAssignedToExecutor,
} from '../utils/ericssonSpreadsheetUtils';

const ROOT = process.cwd();

describe('Área E — Perfis, Permissões, Visibilidade e firestore.rules', () => {
  beforeEach(() => {
    resetMockFirestore();
    installMockLocalStorage();
  });

  it('E-01: normalizeUserRole, hasFullSpreadsheetAccess, isGestorRole e isEngineeringCoordinatorRole para os 5 perfis', () => {
    expect(normalizeUserRole('ADM')).toBe('ADM');
    expect(normalizeUserRole('Coordenador Geral')).toBe('Coordenador Geral');
    expect(normalizeUserRole('Coordenador Engenharia')).toBe('Coordenador Engenharia');
    expect(normalizeUserRole('Vistoriador')).toBe('Vistoriador');
    expect(normalizeUserRole('Executor')).toBe('Executor');
    expect(normalizeUserRole('perfil_desconhecido')).toBe('Executor');

    expect(hasFullSpreadsheetAccess('ADM')).toBe(true);
    expect(hasFullSpreadsheetAccess('Coordenador Geral')).toBe(true);
    expect(hasFullSpreadsheetAccess('Coordenador Engenharia')).toBe(true);
    expect(hasFullSpreadsheetAccess('Vistoriador')).toBe(false);
    expect(hasFullSpreadsheetAccess('Executor')).toBe(false);

    expect(isGestorRole('ADM')).toBe(true);
    expect(isGestorRole('Coordenador Geral')).toBe(true);
    expect(isGestorRole('Coordenador Engenharia')).toBe(true);
    expect(isGestorRole('Vistoriador')).toBe(false);
    expect(isGestorRole('Executor')).toBe(false);
    expect(isEngineeringCoordinatorRole('Coordenador Engenharia')).toBe(true);
  });

  it('E-02: Colunas visíveis do Executor (TSSR = 12 colunas, Ericsson Eng = 11 colunas)', () => {
    expect(TSSR_EXECUTOR_VISIBLE_COLUMNS).toHaveLength(12);
    expect(ERICSSON_EXECUTOR_VISIBLE_COLUMNS).toHaveLength(11);
  });

  it('E-03: canUserAccessVendor para NOKIA, ERICSSON, AMBAS e usuário ADM/Dono', () => {
    const nokiaOnly: AmetaUser = {
      id: '1', name: 'N', email: 'n@ameta.com', role: 'Vistoriador',
      situacao: 'ativo', plataforma: 'NOKIA', accessReleased: true, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const ericOnly: AmetaUser = {
      id: '2', name: 'E', email: 'e@ameta.com', role: 'Vistoriador',
      situacao: 'ativo', plataforma: 'ERICSSON', accessReleased: true, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const ambas: AmetaUser = {
      id: '3', name: 'A', email: 'a@ameta.com', role: 'Executor',
      situacao: 'ativo', plataforma: 'AMBAS', accessReleased: true, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const adm: AmetaUser = {
      id: '4', name: 'ADM', email: 'adm@ameta.com', role: 'ADM',
      situacao: 'ativo', plataforma: 'NOKIA', accessReleased: true, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(canUserAccessVendor(nokiaOnly, 'NOKIA')).toBe(true);
    expect(canUserAccessVendor(nokiaOnly, 'ERICSSON')).toBe(false);
    expect(canUserAccessVendor(ericOnly, 'ERICSSON')).toBe(true);
    expect(canUserAccessVendor(ericOnly, 'NOKIA')).toBe(false);
    expect(canUserAccessVendor(ambas, 'NOKIA')).toBe(true);
    expect(canUserAccessVendor(ambas, 'ERICSSON')).toBe(true);
    expect(canUserAccessVendor(adm, 'NOKIA')).toBe(true);
    expect(canUserAccessVendor(adm, 'ERICSSON')).toBe(true);
    expect(canUserAccessVendor(null, 'NOKIA')).toBe(false);
  });

  it('E-04: canUserAccessVendor deve negar CLARO_TIM para usuário aguardando/bloqueado ou exclusivo ERICSSON', () => {
    const aguardando: AmetaUser = {
      id: 'w1', name: 'Novo', email: 'novo@ameta.com', role: 'Vistoriador',
      situacao: 'aguardando', plataforma: 'NOKIA', accessReleased: false, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };
    const ericOnly: AmetaUser = {
      id: 'e1', name: 'EricOnly', email: 'eo@ameta.com', role: 'Vistoriador',
      situacao: 'ativo', plataforma: 'ERICSSON', accessReleased: true, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(canUserAccessVendor(aguardando, 'NOKIA')).toBe(false);
    // Esperado: aguardando também NÃO deve ter acesso à CLARO_TIM
    expect(canUserAccessVendor(aguardando, 'CLARO_TIM')).toBe(false);
    // Esperado: usuário exclusivo ERICSSON não deveria ter acesso irrestrito à CLARO_TIM
    expect(canUserAccessVendor(ericOnly, 'CLARO_TIM')).toBe(false);
  });

  it('E-05: canUserAccessVendor para usuário SEM plataforma definida não deve liberar NOKIA silenciosamente', () => {
    const semPlat: AmetaUser = {
      id: 'sp1', name: 'Sem Plat', email: 'semplat@ameta.com', role: 'Vistoriador',
      situacao: 'ativo', accessReleased: true, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(canUserAccessVendor(semPlat, 'NOKIA')).toBe(false);
  });

  it('E-06: Simulação "Ver como Executor/Vistoriador" em App.tsx não deve vazar abas de gestor via "|| isRealGestor"', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    // Verifica se canSeeDuplasTab / canAccessDemandaExecutores / canSeeSitesTab usam isRealGestor incondicionalmente
    const duplasBlock = appSrc.match(/const canSeeDuplasTab\s*=[\s\S]*?;/)?.[0] || '';
    expect(duplasBlock).not.toContain('isRealGestor');
  });

  it('E-07: firestore.rules NÃO deve permitir que Executor ou Vistoriador apague planilhas (nokia_sites, claro_sites, ericsson_sites, nokia_tssr, ericsson_engenharia)', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    // Verifica se nokia_sites / claro_sites / ericsson_sites dão delete para canAccessNokia()/canAccessEricsson() (que inclui Executor e Vistoriador)
    const nokiaSitesRule = rules.match(/match \/nokia_sites\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';
    const claroSitesRule = rules.match(/match \/claro_sites\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';
    const ericSitesRule = rules.match(/match \/ericsson_sites\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';

    expect(nokiaSitesRule).not.toMatch(/allow\s+[^;]*delete[^;]*:[^;]*canAccessNokia\(\)/);
    expect(claroSitesRule).not.toMatch(/allow\s+[^;]*delete[^;]*:[^;]*canAccessNokia\(\)/);
    expect(ericSitesRule).not.toMatch(/allow\s+[^;]*delete[^;]*:[^;]*canAccessEricsson\(\)/);
  });

  it('E-08: firestore.rules NÃO deve deixar coleção notificacoes com delete irrestrito para qualquer isSignedIn() (inclusive aguardando/bloqueado)', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const notifRule = rules.match(/match \/notificacoes\/\{docId\}\s*\{[\s\S]*?\}/)?.[0] || '';
    expect(notifRule).not.toMatch(/allow\s+read,\s*write,\s*delete:\s*if\s+isSignedIn\(\)/);
  });
});

describe('Área F — Telas, Funções, Exportação e Edge Cases', () => {
  it('F-01: Busca textual (equivalente a matchesSiteSingleTerm) tolera campos null/undefined, listas vazias e textos muito longos', () => {
    const matchesSiteSingleTerm = (site: TelecomSite, qLower: string): boolean => {
      const colBSiteId = (site.customFields?.['SITE ID'] || site.siteId || '').toString().toLowerCase();
      if (colBSiteId.includes(qLower)) return true;
      const matchStandard =
        (site.siteId || '').toString().toLowerCase().includes(qLower) ||
        (site.siteName || '').toString().toLowerCase().includes(qLower) ||
        (site.municipio || '').toString().toLowerCase().includes(qLower) ||
        (site.uf || '').toString().toLowerCase().includes(qLower) ||
        (site.observacoes || '').toString().toLowerCase().includes(qLower);
      if (matchStandard) return true;
      return site.customFields
        ? Object.values(site.customFields).some((v) => (v || '').toString().toLowerCase().includes(qLower))
        : false;
    };

    const brokenSite = {
      id: 'x',
      siteId: null as unknown as string,
      siteName: undefined as unknown as string,
      municipio: null as unknown as string,
      uf: '',
      observacoes: 'A'.repeat(20000) + 'TARGET_TOKEN',
      customFields: { 'SITE ID': null as unknown as string, Nota: undefined as unknown as string },
    } as unknown as TelecomSite;

    expect(() => matchesSiteSingleTerm(brokenSite, 'target_token')).not.toThrow();
    expect(matchesSiteSingleTerm(brokenSite, 'target_token')).toBe(true);
    expect(matchesSiteSingleTerm(brokenSite, 'inexistente')).toBe(false);
  });

  it('F-02: formatExcelCellValue trata datas válidas, datas inválidas (Invalid Date), null/undefined e quebras de linha', () => {
    expect(formatExcelCellValue(null)).toBe('');
    expect(formatExcelCellValue(undefined)).toBe('');
    expect(formatExcelCellValue(new Date('invalid'))).toBe('');
    expect(formatExcelCellValue(new Date(Date.UTC(2026, 0, 5)))).toBe('05/01/2026');
    expect(formatExcelCellValue('linha1\nlinha2')).toBe('linha1 linha2');
  });

  it('F-03: Edição inline via syncSiteColumnUpdate sincroniza STATUS, progresso, NDPd/NDPc e limpeza de equipe', () => {
    const site: TelecomSite = {
      id: 'S1',
      siteId: 'MAALL01',
      siteName: 'MAALL01_6A',
      vendor: 'CLARO_TIM',
      sheetName: 'Controle Geral',
      uf: 'MA',
      municipio: 'ALTO ALEGRE',
      regional: 'NO',
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
      equipeParceira: 'Magno / Mateus',
      ordemServico: '',
      alarmesAtivos: '',
      observacoes: '',
      updatedAt: '',
      updatedBy: 'qa',
      customFields: { 'SITE ID': 'MAALL01', 'EQUIPE EXECUTANTE': 'Magno / Mateus', EQUIPE: 'Magno / Mateus' },
    };

    const upStatus = syncSiteColumnUpdate(site, 'STATUS', 'Vistoria - Finalizada');
    expect(upStatus.status).toBe('Vistoria - Finalizada');
    expect(upStatus.progressoRollout).toBe(100);

    const upNdp = syncSiteColumnUpdate(site, 'NDPd', 'NDP-123');
    expect(upNdp.customFields?.['NDPd']).toBe('NDP-123');
    expect(upNdp.customFields?.['NDPc TalonView']).toBe('NDP-123');

    const upClear = syncSiteColumnUpdate(site, 'EQUIPE EXECUTANTE', 'Sem Dupla');
    expect(upClear.equipe).toBe('');
    expect(upClear.responsavelDemand).toBe('');
    // Atenção: verifica se customFields['EQUIPE'] também foi limpo ao limpar 'EQUIPE EXECUTANTE'!
    expect(upClear.customFields?.['EQUIPE']).toBe('');
  });

  it('F-04: buildExportRows respeita orderedColumns exatas e mapeamento getCellValueForColumn', () => {
    const site = {
      id: '1',
      siteId: 'MAALL01',
      siteName: 'MAALL01_6A',
      vendor: 'CLARO_TIM',
      sheetName: 'Controle Geral',
      uf: 'MA',
      municipio: 'ALTO ALEGRE',
      status: 'Vistoria - Finalizada',
      customFields: {
        'SITE ID': 'MAALL01',
        'ID. DETENTORA': 'DET-UPPER',
        'ID detentora': 'det-lower',
        CRQ: 'CRQ0001',
        NDPd: 'NDP-9',
      },
    } as unknown as TelecomSite;

    const cols = ['SITE ID', 'ID. DETENTORA', 'ID detentora', 'CRQ', 'NDPd', 'STATUS'];
    const rows = buildExportRows([site], cols);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(cols);
    expect(rows[0]['ID. DETENTORA']).toBe('DET-UPPER');
    expect(rows[0]['ID detentora']).toBe('det-lower');
    expect(getCellValueForColumn(site, 'NDPc TalonView')).toBe('NDP-9');
  });

  it('F-05: Ericsson Engenharia — detecção de reprovados, estatísticas consolidadas e vínculo por executor', () => {
    const rows: EricssonEngineeringRow[] = [
      {
        id: '1', rowKey: '1', rowIndex: 1, intervencaoClaro: 'INT1', siteIdA: 'A1', siteIdB: 'B1',
        statusA: 'Finalizado', statusB: 'Finalizado', tipoDoc: 'WR', status: 'Finalizado',
        regional: 'SUL', tipoSite: 'GF', executor: 'Ana Paula', meta: 'Meta 1',
        fields: { Status: 'Finalizado', 'Tipo doc': 'WR', Meta: 'Meta 1', EXECUTOR: 'Ana Paula' },
        siteAVistoriaStatus: 'Entregue', updatedAt: '',
      },
      {
        id: '2', rowKey: '2', rowIndex: 2, intervencaoClaro: 'INT2', siteIdA: 'A2', siteIdB: 'B2',
        statusA: 'Em correção', statusB: 'Em correção', tipoDoc: 'QRF', status: 'Em correção',
        regional: 'SUL', tipoSite: 'GF', executor: 'Fulvio / Alex', meta: 'Meta 1',
        fields: { Status: 'Em correção', 'Tipo doc': 'QRF', Meta: 'Meta 1', EXECUTOR: 'Fulvio / Alex' },
        siteAVistoriaStatus: 'Pendente', updatedAt: '',
      },
    ];

    expect(isEricssonRowReproved(rows[0])).toBe(false);
    expect(isEricssonRowReproved(rows[1])).toBe(true);
    expect(isEricssonRowAssignedToExecutor(rows[0], 'Ana Paula')).toBe(true);
    expect(isEricssonRowAssignedToExecutor(rows[1], 'Alex')).toBe(true);

    const stats = computeEricssonConsolidatedStats(rows);
    expect(stats.totalRows).toBe(2);
    expect(stats.wr.finalizado).toBe(1);
    expect(stats.wr.taxaFinalizacao).toBe(100);
    expect(stats.qrf.total).toBe(1);
    expect(stats.qrf.finalizado).toBe(0);
  });

  it('F-06: Atualização automática de planilha ao concluir acionamento CLARO_TIM em App.tsx consulta claroSites (não apenas sites Nokia)', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    const blockMatch = appSrc.match(/if\s*\(ac\.vendor === 'NOKIA' \|\| ac\.vendor === 'CLARO_TIM'\)\s*\{[\s\S]{0,400}/);
    expect(blockMatch).not.toBeNull();
    // Esperado: consultar claroSitesRef / claroSites quando ac.vendor === 'CLARO_TIM'
    expect(blockMatch![0]).toContain('claro');
  });
});

describe('Área G — Segurança', () => {
  it('G-01: Nenhuma função de apagar planilhas ou cadastros em massa existe em dataService ou componentes', () => {
    const dataSvc = fs.readFileSync(path.join(ROOT, 'src/services/dataService.ts'), 'utf8');
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    const adminSrc = fs.readFileSync(path.join(ROOT, 'src/components/AdminAccessPanel.tsx'), 'utf8');

    for (const forbidden of ['zerarTodasPlanilhas', 'zerarEricssonPlanilhas', 'zerarClaroSites', 'zerarCadastros']) {
      expect(dataSvc).not.toContain(forbidden);
      expect(appSrc).not.toContain(forbidden);
      expect(adminSrc).not.toContain(forbidden);
    }
  });

  it('G-02: Senhas padrão hardcoded NÃO devem existir no código-fonte frontend', () => {
    const adminSrc = fs.readFileSync(path.join(ROOT, 'src/components/AdminAccessPanel.tsx'), 'utf8');
    expect(adminSrc).not.toContain('ameta2026');
  });

  it('G-03: AuthGate primeiro acesso NÃO deve permitir pular verificação dos 3 dígitos do CPF deixando campo vazio', () => {
    const authSrc = fs.readFileSync(path.join(ROOT, 'src/components/AuthGate.tsx'), 'utf8');
    // O bug ocorre quando exige `cpf3DigitsInput.length === 3` antes de validar, pulando se vazio!
    expect(authSrc).not.toMatch(/if\s*\(cleanCpf\.length\s*>=\s*3\s*&&\s*cpf3DigitsInput\.length\s*===\s*3\)/);
  });

  it('G-04: Nenhum segredo/chave privada ou lista de CPFs hardcoded no código-fonte', () => {
    const telecomSrc = fs.readFileSync(path.join(ROOT, 'src/types/telecom.ts'), 'utf8');
    // Verifica ausência de CPFs formatados hardcoded
    expect(telecomSrc).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });
});
