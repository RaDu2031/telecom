import React, { useState, useEffect } from 'react';
import { X, Plus, Sparkles, UserCheck, Receipt } from 'lucide-react';
import {
  TelecomSite,
  VendorType,
  SiteStatus,
  SpreadsheetMeta,
  AmetaUser,
} from '../types/telecom';
import { STATUS_FINANCEIRO_OPTIONS, getShortResponsibleLabel } from '../utils/spreadsheetUtils';

interface NewSiteModalProps {
  isOpen: boolean;
  inlineTabMode?: boolean;
  activeVendor: VendorType;
  activeSheetName: string;
  sheets: SpreadsheetMeta[];
  users?: AmetaUser[];
  onClose: () => void;
  onCreateSite: (siteData: Omit<TelecomSite, 'id' | 'updatedAt'>) => Promise<void>;
}

export const NewSiteModal: React.FC<NewSiteModalProps> = ({
  isOpen,
  inlineTabMode = false,
  activeVendor,
  activeSheetName,
  sheets,
  users = [],
  onClose,
  onCreateSite,
}) => {
  const [vendor, setVendor] = useState<VendorType>(activeVendor);
  const [sheetName, setSheetName] = useState(activeSheetName);
  const [siteId, setSiteId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [uf, setUf] = useState('SP');
  const [municipio, setMunicipio] = useState('São Paulo');
  const [regional, setRegional] = useState('TCO');
  const [endereco, setEndereco] = useState('');
  const [latitude, setLatitude] = useState('-23.550520');
  const [longitude, setLongitude] = useState('-46.633308');
  const [tipoInfra, setTipoInfra] = useState('Greenfield');
  const [tecnologias, setTecnologias] = useState('Swap - G3');
  const [bandas, setBandas] = useState('700 / 1800 / 2600 / 3500 MHz');
  const [gabineteBbu, setGabineteBbu] = useState('');
  const [modulosRf, setModulosRf] = useState('');
  const [versaoSw, setVersaoSw] = useState('Engenharia');
  const [ipGerencia, setIpGerencia] = useState('10.142.10.50');
  const [status, setStatus] = useState<SiteStatus>('Vistoria - A Executar');
  const [responsavelCampo, setResponsavelCampo] = useState('Magno');
  const [equipeParceira, setEquipeParceira] = useState('Magno/Luchini');
  const [statusFinanceiro, setStatusFinanceiro] = useState('Aguardando SPO');
  const [observacoes, setObservacoes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setVendor(activeVendor);
    setSheetName(activeSheetName);
    if (activeVendor === 'NOKIA') {
      setSiteId(`SN-${Math.floor(1000 + Math.random() * 9000)}`);
      setGabineteBbu('SMP-WO-0399001');
      setModulosRf('BR50999-A');
      setVersaoSw('Engenharia');
      setStatus('Vistoria - A Executar');
      setRegional('TCO');
      setTecnologias('Swap - G3');
      setResponsavelCampo('Magno');
      setEquipeParceira('Magno/Luchini');
      setStatusFinanceiro('Aguardando SPO');
    } else {
      setSiteId(`ER-RJ-${Math.floor(1000 + Math.random() * 9000)}`);
      setGabineteBbu('Ericsson Baseband 6648 + Baseband 6630');
      setModulosRf('3x AIR 6419 B42 + 3x Radio 4415 B3');
      setVersaoSw('ENM 24.Q1');
      setStatus('Ativo');
    }
  }, [activeVendor, activeSheetName, isOpen]);

  if (!isOpen) return null;

  const vendorSheets = sheets.filter((s) => s.vendor === vendor);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId.trim()) return;
    setSubmitting(true);
    try {
      const ocPre = String(Math.floor(1400000 + Math.random() * 90000));
      const cleanSiteId = siteId.trim().toUpperCase();
      const cleanEndId =
        siteName.trim() || `${uf}_${municipio.toUpperCase().replace(/\s+/g, '_')}_01`;
      const todayBr = new Date().toLocaleDateString('pt-BR');
      const cleanResp = responsavelCampo.trim() || 'Magno';
      const cleanEquipe = equipeParceira.trim() || cleanResp;
      const cleanFin = statusFinanceiro.trim();

      await onCreateSite({
        siteId: cleanSiteId,
        vendor,
        sheetName: sheetName || 'Controle Geral',
        siteName: cleanEndId,
        uf: uf.trim().toUpperCase(),
        municipio: municipio.trim(),
        regional: regional.trim(),
        endereco: endereco.trim() || `${municipio} - ${uf}`,
        latitude: latitude.trim(),
        longitude: longitude.trim(),
        tipoInfra,
        tecnologias,
        bandas,
        gabineteBbu,
        modulosRf,
        versaoSw,
        setores: 'E2E',
        azimutes: '',
        alturaAntena: '',
        tiltEletrico: '',
        transporteTx: 'Aprovado',
        ipGerencia,
        vlanOm: '',
        energiaRetificadora: 'TIM',
        status,
        progressoRollout:
          String(status).toLowerCase().includes('finalizada') || status === 'Ativo' ? 100 : 70,
        dataIntegracao: todayBr,
        dataAtivacao: todayBr,
        responsavelCampo: cleanResp,
        equipeParceira: cleanEquipe,
        ordemServico: ocPre,
        alarmesAtivos: cleanFin,
        observacoes: observacoes.trim(),
        isNew: true,
        createdAt: new Date().toISOString(),
        customFields: {
          'Oc Site Pre': ocPre,
          'SITE ID': cleanSiteId,
          'END ID': cleanEndId,
          SMP: gabineteBbu,
          'ID. DETENTORA': modulosRf,
          'REG.': regional.trim(),
          UF: uf.trim().toUpperCase(),
          MUNICÍPIO: municipio.trim(),
          PROJETO: tecnologias,
          Prioridade: versaoSw,
          STATUS: status,
          ACIONAMENTO: todayBr,
          'EQUIPE EXECUTANTE': cleanEquipe,
          Executor: cleanResp,
          'Tipo Site': tipoInfra,
          'Status Financeiro': cleanFin,
          'Observações/Motivo': observacoes.trim(),
        },
        updatedBy: 'rafael.araujo@ametaservicos.com.br',
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={
        inlineTabMode
          ? 'w-full'
          : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs'
      }
    >
      <div
        className={
          inlineTabMode
            ? 'w-full max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm'
            : 'w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[90vh]'
        }
      >
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              Adicionar Novo Site na Planilha ({vendor})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              O registro será inserido e sincronizado imediatamente em tempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Fabricante</label>
              <select
                value={vendor}
                onChange={(e) => {
                  const v = e.target.value as VendorType;
                  setVendor(v);
                  const firstSheet = sheets.find((s) => s.vendor === v);
                  if (firstSheet) setSheetName(firstSheet.name);
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="NOKIA">NOKIA</option>
                <option value="ERICSSON">ERICSSON</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Planilha Destino</label>
              <select
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {vendorSheets.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Site ID *</label>
              <input
                type="text"
                required
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                placeholder="Ex: NK-SP-0199"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-blue-500 tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Nome da Estação *</label>
              <input
                type="text"
                required
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="Ex: SP_JARDINS_NORTE_01"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">UF</label>
                <input
                  type="text"
                  maxLength={2}
                  value={uf}
                  onChange={(e) => setUf(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Município</label>
                <input
                  type="text"
                  value={municipio}
                  onChange={(e) => setMunicipio(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Status Operacional</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SiteStatus)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Vistoria - A Executar">Vistoria - A Executar</option>
                <option value="Vistoria - Em Andamento">Vistoria - Em Andamento</option>
                <option value="Vistoria - Finalizada">Vistoria - Finalizada</option>
                <option value="Acesso - Solicitado p/ Nokia">Acesso - Solicitado p/ Nokia</option>
                <option value="Vistoria - Sem Chave">Vistoria - Sem Chave</option>
                <option value="Vistoria - Sem Acesso">Vistoria - Sem Acesso</option>
                <option value="Ativo">Ativo</option>
                <option value="Em Comissionamento">Em Comissionamento</option>
                <option value="Em Implantação">Em Implantação</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-emerald-400 font-semibold mb-1 flex items-center gap-1">
                <Receipt className="w-3.5 h-3.5" />
                <span>Status Financeiro</span>
              </label>
              <select
                value={statusFinanceiro}
                onChange={(e) => setStatusFinanceiro(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {STATUS_FINANCEIRO_OPTIONS.map((fin) => (
                  <option key={fin} value={fin}>
                    {fin}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-blue-400 font-semibold mb-1 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Responsável (Demanda do Usuário)</span>
              </label>
              <input
                type="text"
                list="ameta-responsavel-list"
                value={responsavelCampo}
                onChange={(e) => {
                  setResponsavelCampo(e.target.value);
                  if (!equipeParceira || equipeParceira === responsavelCampo) {
                    setEquipeParceira(e.target.value);
                  }
                }}
                placeholder="Ex: Magno, Mateus, Gilvan, Luchini..."
                className="w-full px-3 py-2 bg-slate-950 border border-blue-500/50 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <datalist id="ameta-responsavel-list">
                <option value="Magno" />
                <option value="Mateus" />
                <option value="Gilvan" />
                <option value="Luchini" />
                <option value="Oglio" />
                <option value="Diego" />
                <option value="Vagner" />
                <option value="Malta" />
                <option value="Luís Fernando" />
                <option value="Bruno" />
                <option value="Kleber" />
                <option value="Alexandre" />
                <option value="Felipe" />
                <option value="Renato" />
                {users.map((u) => (
                  <option key={u.id} value={getShortResponsibleLabel(u.name)} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Equipe Executante</label>
              <input
                type="text"
                value={equipeParceira}
                onChange={(e) => setEquipeParceira(e.target.value)}
                placeholder="Ex: Magno/Luchini, Magno/Gilvan, Mateus/Oglio"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">SMP / Gabinete</label>
              <input
                type="text"
                value={gabineteBbu}
                onChange={(e) => setGabineteBbu(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">ID Detentora / RF</label>
              <input
                type="text"
                value={modulosRf}
                onChange={(e) => setModulosRf(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Observações / Motivo</label>
              <input
                type="text"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Observações do site..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-800/50 text-xs text-blue-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              Este site entrará marcado como <strong>NOVO</strong> e aparecerá automaticamente na demanda do responsável <strong>{responsavelCampo || 'Magno'}</strong>.
            </span>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? 'Adicionando...' : 'Adicionar Site na Planilha'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
