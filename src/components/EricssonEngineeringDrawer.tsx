import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  FileSpreadsheet,
  Edit3,
  Save,
  CheckCircle2,
  Clock,
  HelpCircle,
  AlertTriangle,
  Upload,
  Download,
  Paperclip,
  History,
  FileText,
  User,
  MapPin,
  Building,
  Tag,
  Search,
  CheckSquare,
  ShieldCheck,
  HardHat,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  Lock,
} from 'lucide-react';
import {
  AmetaUser,
  UserRole,
  EricssonEngineeringRow,
  EricssonAttachedFile,
  EricssonAuditLogEntry,
  EngineeringFile,
  ERICSSON_SITE_LIST_COLUMNS,
} from '../types/telecom';
import {
  classifyEricssonDocGroup,
  classifyEricssonStatus,
} from '../utils/ericssonSpreadsheetUtils';

export interface EricssonEngineeringDrawerProps {
  row: EricssonEngineeringRow | null;
  isOpen: boolean;
  user: AmetaUser;
  effectiveRole: UserRole;
  isOwner?: boolean;
  readOnly?: boolean;
  files?: EngineeringFile[];
  onClose: () => void;
  onSaveRow: (updatedRow: EricssonEngineeringRow) => Promise<void>;
  showToast: (msg: string) => void;
}

export const EricssonEngineeringDrawer: React.FC<EricssonEngineeringDrawerProps> = ({
  row,
  isOpen,
  user,
  effectiveRole,
  isOwner = false,
  readOnly = false,
  files = [],
  onClose,
  onSaveRow,
  showToast,
}) => {
  // Permission calculation
  const canEdit = useMemo(() => {
    if (readOnly) return false;
    if (isOwner) return true;
    if (user?.situacao === 'dono') return true;
    if (effectiveRole === 'ADM' || effectiveRole === 'Coordenador Geral' || effectiveRole === 'Coordenador Engenharia') {
      return true;
    }
    if (effectiveRole === 'Executor') {
      const assigned = (row?.executor || row?.fields?.['EXECUTOR'] || '').toLowerCase().trim();
      const userName = (user?.name || '').toLowerCase().trim();
      return !assigned || (userName && (assigned.includes(userName) || userName.includes(assigned)));
    }
    return false;
  }, [isOwner, user, effectiveRole, row]);

  // Tab & editing states
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'geral' | 'docs' | 'campos' | 'arquivos' | 'historico'>('geral');
  const [fieldsSearch, setFieldsSearch] = useState<string>('');

  // Form edit states
  const [formIntervencao, setFormIntervencao] = useState<string>('');
  const [formSiteIdA, setFormSiteIdA] = useState<string>('');
  const [formSiteIdB, setFormSiteIdB] = useState<string>('');
  const [formStatusA, setFormStatusA] = useState<string>('Pendente');
  const [formStatusB, setFormStatusB] = useState<string>('Pendente');
  const [formTipoDoc, setFormTipoDoc] = useState<string>('WR');
  const [formStatus, setFormStatus] = useState<string>('Finalizado');
  const [formRegional, setFormRegional] = useState<string>('SPM');
  const [formTipoSite, setFormTipoSite] = useState<string>('REUSO');
  const [formExecutor, setFormExecutor] = useState<string>('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState<boolean>(false);

  // Sync form when row changes
  useEffect(() => {
    if (row) {
      const ex = (
        row.executor ||
        row.fields?.['EXECUTOR'] ||
        row.fields?.['EXECUTOR WR'] ||
        row.fields?.['EXECUTOR QRF'] ||
        row.fields?.['EXECUTOR PPI'] ||
        row.fields?.['Executor'] ||
        ''
      ).trim();
      setFormIntervencao(row.intervencaoClaro || row.fields?.['Intervencao Claro'] || '');
      setFormSiteIdA(row.siteIdA || row.intervencaoClaro || '');
      setFormSiteIdB(row.siteIdB || '');
      setFormStatusA(row.statusA || row.status || row.fields?.['Status'] || 'Pendente');
      setFormStatusB(row.statusB || row.status || row.fields?.['Status'] || 'Pendente');
      setFormTipoDoc(row.tipoDoc || row.fields?.['Tipo doc'] || 'WR');
      setFormStatus(row.status || row.fields?.['Status'] || 'Finalizado');
      setFormRegional(row.regional || row.fields?.['Regional'] || 'SPM');
      setFormTipoSite(row.tipoSite || row.fields?.['TIPO SITE'] || 'REUSO');
      setFormExecutor(ex);
      setFormFields({ ...(row.fields || {}) });
      setIsEditing(false);
    }
  }, [row]);

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Attached files list memo
  const attachedFilesList: EricssonAttachedFile[] = useMemo(() => {
    if (!row) return [];
    const list: EricssonAttachedFile[] = Array.isArray(row.attachedFiles) ? [...row.attachedFiles] : [];
    if (row.attachedFileName && !list.some((f) => f.id === row.attachedFileId || f.name === row.attachedFileName)) {
      list.push({
        id: row.attachedFileId || 'file-main',
        name: row.attachedFileName,
        url: row.attachedFileUrl || `/api/ericsson/engenharia/files/${row.attachedFileId}/download`,
        uploadedBy: row.attachedUploadedBy || 'Equipe Engenharia',
        uploadedAt: row.attachedUploadedAt || row.updatedAt || new Date().toISOString(),
      });
    }

    // Also include files uploaded to Projeto Claro or Vistoria matching this row ID or Intervencao
    const intervencao = (row.intervencaoClaro || row.fields?.['Intervencao Claro'] || '').trim().toLowerCase();
    files.forEach((fl) => {
      const flInterv = (fl.intervencaoClaro || fl.siteId || '').trim().toLowerCase();
      const matchesRow =
        (fl.engineeringRowId && fl.engineeringRowId === row.id) ||
        (fl.rowId && fl.rowId === row.id) ||
        (intervencao && flInterv && (flInterv === intervencao || flInterv.includes(intervencao)));

      if (matchesRow && !list.some((existing) => existing.id === fl.id || existing.name === fl.fileName)) {
        list.push({
          id: fl.id,
          name: fl.fileName,
          url: `/api/ericsson/files/${encodeURIComponent(fl.id)}/download`,
          uploadedBy: fl.uploadedByName || 'Equipe',
          uploadedAt: fl.uploadedAt || new Date().toISOString(),
        });
      }
    });

    return list;
  }, [row, files]);

  // History list memo
  const historyList: EricssonAuditLogEntry[] = useMemo(() => {
    if (!row || !Array.isArray(row.history)) return [];
    return row.history;
  }, [row]);

  // All fields list memo
  const allFieldEntries = useMemo(() => {
    if (!row) return [];
    const fields = row.fields || {};
    const keys = Object.keys(fields);
    const orderedKeys = Array.from(new Set([...ERICSSON_SITE_LIST_COLUMNS, ...keys])).filter(
      (k) => fields[k] !== undefined
    );
    return orderedKeys.map((k) => ({
      key: k,
      value: fields[k],
    }));
  }, [row]);

  // Filtered fields list memo
  const filteredFields = useMemo(() => {
    if (!fieldsSearch.trim()) return allFieldEntries;
    const q = fieldsSearch.toLowerCase().trim();
    return allFieldEntries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(q) ||
        String(entry.value || '').toLowerCase().includes(q)
    );
  }, [allFieldEntries, fieldsSearch]);

  // ALL HOOKS HAVE BEEN CALLED. NOW SAFELY CHECK OPEN / ROW
  if (!isOpen || !row) return null;

  const currentStatusCat = classifyEricssonStatus(row.status || row.fields?.['Status'] || '');
  const currentDocGroup = classifyEricssonDocGroup(row.tipoDoc || row.fields?.['Tipo doc'] || '');

  // Determine site A and site B labels
  const siteA = row.siteIdA || row.intervencaoClaro || 'Site A';
  const siteB = row.siteIdB || '';

  const currentExecutor = (
    row.executor ||
    row.fields?.['EXECUTOR'] ||
    row.fields?.['EXECUTOR WR'] ||
    row.fields?.['EXECUTOR QRF'] ||
    row.fields?.['EXECUTOR PPI'] ||
    row.fields?.['Executor'] ||
    ''
  ).trim();

  const safeTipoDoc = String(row.tipoDoc || row.fields?.['Tipo doc'] || '').toUpperCase();

  // Documentation breakdown extraction
  const docWrStatus = row.fields?.['WR ENTREGUE']
    ? 'Finalizado'
    : (row.fields?.['WR REVISAR']
    ? 'Dúvida'
    : (safeTipoDoc.includes('WR') ? row.status || 'Pendente' : 'Pendente'));

  const docQrfStatus = row.fields?.['QRF ENTREGUE']
    ? 'Finalizado'
    : (row.fields?.['QRF REVISAR']
    ? 'Dúvida'
    : (safeTipoDoc.includes('QRF') ? row.status || 'Pendente' : 'Pendente'));

  const docPpiStatus = row.fields?.['PPI ENTREGUE']
    ? 'Finalizado'
    : (row.fields?.['PPI REVISAR']
    ? 'Dúvida'
    : (safeTipoDoc.includes('PPI') ? row.status || 'Pendente' : 'Pendente'));

  const docBoqStatus = safeTipoDoc.includes('BOQ')
    ? row.status || 'Pendente'
    : (row.fields?.['Fat. Adicional'] || row.fields?.['Faturamento'] ? 'Finalizado' : 'Pendente');

  // Helper to resolve executor name for each document section (WR, QRF, PPI)
  const getDocExecutorDisplay = (docKey: 'WR' | 'QRF' | 'PPI'): string => {
    const specific = (
      row.fields?.[`EXECUTOR ${docKey}`] ||
      row.fields?.[`Executor ${docKey}`] ||
      ''
    ).trim();
    if (specific && specific !== '—' && specific !== '-') return specific;
    
    // If this document is the primary doc type of the site or finalized, use the assigned site executor
    if (safeTipoDoc.includes(docKey)) return currentExecutor || '—';
    if (docKey === 'WR' && (docWrStatus === 'Finalizado' || docWrStatus === 'Em produção')) {
      return currentExecutor || '—';
    }
    if (docKey === 'QRF' && (docQrfStatus === 'Finalizado' || docQrfStatus === 'Em produção')) {
      return currentExecutor || '—';
    }
    if (docKey === 'PPI' && (docPpiStatus === 'Finalizado' || docPpiStatus === 'Em produção')) {
      return currentExecutor || '—';
    }
    
    return currentExecutor || '—';
  };

  // Helper to resolve delivery date for each document
  const getDocDeliveryDisplay = (docKey: 'WR' | 'QRF' | 'PPI'): string => {
    const specific = (row.fields?.[`${docKey} ENTREGUE`] || '').trim();
    if (specific && specific !== '—' && specific !== '-') return specific;
    const generalEntregue = (row.fields?.['Entregue'] || '').trim();
    const isDocFinalizado =
      (docKey === 'WR' && docWrStatus === 'Finalizado') ||
      (docKey === 'QRF' && docQrfStatus === 'Finalizado') ||
      (docKey === 'PPI' && docPpiStatus === 'Finalizado') ||
      (safeTipoDoc.includes(docKey) && (row.status === 'Finalizado' || row.statusA === 'Finalizado'));
    
    if (isDocFinalizado) {
      if (generalEntregue && generalEntregue !== '—' && generalEntregue !== '-') {
        return generalEntregue;
      }
      if (row.updatedAt) {
        try {
          const d = new Date(row.updatedAt);
          if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
        } catch {}
      }
      return 'Finalizado';
    }
    return '—';
  };

  // Helper to resolve planned date for each document
  const getDocPlanDisplay = (docKey: 'WR' | 'QRF' | 'PPI'): string => {
    const specific = (
      row.fields?.[`${docKey} REV. PLAN`] ||
      row.fields?.[`${docKey} - PREVISÃO DE ENTREGA`] ||
      ''
    ).trim();
    if (specific && specific !== '—' && specific !== '-') return specific;
    const planejado = (row.fields?.['Planejado'] || row.fields?.['Demanda'] || '').trim();
    if (planejado && planejado !== '—' && safeTipoDoc.includes(docKey)) return planejado;
    return '—';
  };

  // Handle Save
  const handleSave = async () => {
    if (!formIntervencao.trim() && !formSiteIdA.trim()) {
      showToast('Informe a Intervenção Claro ou o Site ID.');
      return;
    }

    try {
      setIsSaving(true);
      const todayStr = new Date().toLocaleDateString('pt-BR');
      const updatedFields: Record<string, string> = {
        ...formFields,
        'Intervencao Claro': formIntervencao.trim(),
        'Tipo doc': formTipoDoc,
        Status: formStatus,
        Regional: formRegional,
        'TIPO SITE': formTipoSite,
        EXECUTOR: formExecutor.trim(),
      };

      if (formExecutor.trim()) {
        const cleanEx = formExecutor.trim();
        if (formTipoDoc.includes('WR')) updatedFields['EXECUTOR WR'] = cleanEx;
        if (formTipoDoc.includes('QRF')) updatedFields['EXECUTOR QRF'] = cleanEx;
        if (formTipoDoc.includes('PPI')) updatedFields['EXECUTOR PPI'] = cleanEx;
      }

      if (formStatus === 'Finalizado') {
        if (!updatedFields['Entregue']) updatedFields['Entregue'] = todayStr;
        if (formTipoDoc.includes('WR') && !updatedFields['WR ENTREGUE']) {
          updatedFields['WR ENTREGUE'] = todayStr;
        }
        if (formTipoDoc.includes('QRF') && !updatedFields['QRF ENTREGUE']) {
          updatedFields['QRF ENTREGUE'] = todayStr;
        }
        if (formTipoDoc.includes('PPI') && !updatedFields['PPI ENTREGUE']) {
          updatedFields['PPI ENTREGUE'] = todayStr;
        }
      }

      const payload: Partial<EricssonEngineeringRow> & { updaterName?: string; updaterEmail?: string } = {
        intervencaoClaro: formIntervencao.trim(),
        siteIdA: formSiteIdA.trim() || formIntervencao.trim(),
        siteIdB: formSiteIdB.trim(),
        statusA: formStatusA,
        statusB: formSiteIdB.trim() ? formStatusB : '',
        tipoDoc: formTipoDoc,
        status: formStatus,
        regional: formRegional,
        tipoSite: formTipoSite,
        executor: formExecutor.trim(),
        fields: updatedFields,
        updaterName: user?.name || 'Usuário',
        updaterEmail: user?.email || '',
      };

      const res = await fetch(`/api/ericsson/engenharia/rows/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        await onSaveRow(data.row || { ...row, ...payload, fields: updatedFields });
        setIsEditing(false);
        showToast(`Site ${formIntervencao || row.intervencaoClaro} atualizado com sucesso!`);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Erro ao salvar: ${err.error || 'Falha na gravação'}`);
      }
    } catch (e) {
      showToast('Erro de rede ao salvar alterações.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle direct file upload from drawer
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingFile(true);
      showToast(`Enviando arquivo "${file.name}"...`);
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const res = await fetch('/api/ericsson/engenharia/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rowId: row.id,
            fileName: file.name,
            fileDataUrl: base64Data,
            uploaderName: user?.name || 'Usuário',
            uploaderEmail: user?.email || '',
          }),
        });

        if (res.ok) {
          const data = await res.json();
          await onSaveRow(data.row);
          showToast(`Arquivo "${file.name}" anexado com sucesso!`);
        } else {
          showToast('Erro ao anexar arquivo no servidor.');
        }
        setIsUploadingFile(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setIsUploadingFile(false);
      showToast('Falha no upload do anexo.');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Side Drawer Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex">
        <div className="w-screen max-w-2xl bg-white shadow-2xl flex flex-col z-50 border-l border-slate-200 animate-in slide-in-from-right duration-200 max-sm:w-full">
          
          {/* =====================================================================
              1. DRAWER HEADER
             ===================================================================== */}
          <div className="p-4 sm:p-6 bg-slate-900 text-white flex flex-col gap-3 border-b border-slate-800 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/40">
                    ENGENHARIA ERICSSON
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-xs text-slate-400 font-mono">
                    ID: {row.id}
                  </span>
                </div>
                
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>{row.intervencaoClaro || siteA}</span>
                  {row.tipoSite && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                      {row.tipoSite}
                    </span>
                  )}
                </h2>

                <p className="text-xs text-slate-300 flex items-center gap-2 flex-wrap">
                  {row.regional && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-teal-400" />
                      <strong>Regional:</strong> {row.regional}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-slate-300">
                    <User className="w-3 h-3 text-teal-400" />
                    <strong>Executor:</strong> {currentExecutor || 'Sem executor'}
                  </span>
                </p>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
                title="Fechar painel (ESC)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Dual Site IDs & Overall Status Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/80">
              {/* Site A Badge */}
              <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 flex flex-col gap-1">
                <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                  Torre A (Site ID A)
                </span>
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-bold text-xs text-white truncate">
                    {siteA}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      (row.statusA || row.status) === 'Finalizado'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {row.statusA || row.status || 'Pendente'}
                  </span>
                </div>
              </div>

              {/* Site B Badge */}
              <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 flex flex-col gap-1">
                <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">
                  Torre B (Site ID B)
                </span>
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-bold text-xs text-white truncate">
                    {siteB || '—'}
                  </span>
                  {siteB ? (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        (row.statusB || row.status) === 'Finalizado'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      }`}
                    >
                      {row.statusB || row.status || 'Pendente'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 italic">Individual</span>
                  )}
                </div>
              </div>

              {/* Status Geral */}
              <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 flex flex-col gap-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Status Geral
                </span>
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-black border ${
                      currentStatusCat === 'Finalizado'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : currentStatusCat === 'Em produção'
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                        : currentStatusCat === 'Dúvida'
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {row.status || 'Pendente'}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    {row.tipoDoc || 'WR'}
                  </span>
                </div>
              </div>
            </div>

            {/* Navigation tabs & Edit mode toggle */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold py-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('geral')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'geral'
                      ? 'bg-teal-500 text-white font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Visão Geral
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('docs')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'docs'
                      ? 'bg-teal-500 text-white font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Documentação ({currentDocGroup})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('campos')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'campos'
                      ? 'bg-teal-500 text-white font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Planilha ({allFieldEntries.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('arquivos')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'arquivos'
                      ? 'bg-teal-500 text-white font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Arquivos ({attachedFilesList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('historico')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    activeTab === 'historico'
                      ? 'bg-teal-500 text-white font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Histórico ({historyList.length})
                </button>
              </div>

              {/* Edit Toggle / Save Button */}
              {canEdit ? (
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={handleSave}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSaving ? 'Salvando...' : 'Salvar'}</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1E8E8D] hover:bg-[#177271] text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Editar Site</span>
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-slate-400 italic flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Modo leitura
                </span>
              )}
            </div>
          </div>

          {/* =====================================================================
              2. DRAWER BODY CONTENT
             ===================================================================== */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-50/50">
            
            {/* TAB: VISÃO GERAL */}
            {activeTab === 'geral' && (
              <div className="space-y-5">
                {isEditing ? (
                  <div className="bg-white border border-teal-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 text-teal-800 font-bold text-xs border-b border-teal-100 pb-2">
                      <Edit3 className="w-4 h-4 text-teal-600" />
                      <span>Editando Informações Principais do Site</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="sm:col-span-2">
                        <label className="block font-bold text-slate-700 mb-1">
                          Intervenção Claro (Site):
                        </label>
                        <input
                          type="text"
                          value={formIntervencao}
                          onChange={(e) => setFormIntervencao(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-xs focus:outline-none focus:border-teal-500 focus:bg-white"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-amber-900 mb-1">
                          Torre A (Site ID A):
                        </label>
                        <input
                          type="text"
                          value={formSiteIdA}
                          onChange={(e) => setFormSiteIdA(e.target.value)}
                          className="w-full px-3 py-2 bg-amber-50/40 border border-amber-300 rounded-xl font-mono font-bold text-xs focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-amber-900 mb-1">
                          Status Site A:
                        </label>
                        <select
                          value={formStatusA}
                          onChange={(e) => setFormStatusA(e.target.value)}
                          className="w-full px-3 py-2 bg-amber-50/40 border border-amber-300 rounded-xl text-xs focus:outline-none"
                        >
                          <option value="Finalizado">Finalizado</option>
                          <option value="Em produção">Em produção</option>
                          <option value="Pendente">Pendente</option>
                          <option value="Pendente - Dúvida">Pendente - Dúvida</option>
                          <option value="Documentação paralisada">Documentação paralisada</option>
                          <option value="Demanda cancelada">Demanda cancelada</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold text-cyan-900 mb-1">
                          Torre B (Site ID B):
                        </label>
                        <input
                          type="text"
                          value={formSiteIdB}
                          onChange={(e) => setFormSiteIdB(e.target.value)}
                          placeholder="Deixe vazio se único"
                          className="w-full px-3 py-2 bg-cyan-50/40 border border-cyan-300 rounded-xl font-mono font-bold text-xs focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-cyan-900 mb-1">
                          Status Site B:
                        </label>
                        <select
                          value={formStatusB}
                          onChange={(e) => setFormStatusB(e.target.value)}
                          className="w-full px-3 py-2 bg-cyan-50/40 border border-cyan-300 rounded-xl text-xs focus:outline-none"
                        >
                          <option value="Finalizado">Finalizado</option>
                          <option value="Em produção">Em produção</option>
                          <option value="Pendente">Pendente</option>
                          <option value="Pendente - Dúvida">Pendente - Dúvida</option>
                          <option value="Documentação paralisada">Documentação paralisada</option>
                          <option value="Demanda cancelada">Demanda cancelada</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Tipo doc:
                        </label>
                        <select
                          value={formTipoDoc}
                          onChange={(e) => setFormTipoDoc(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-teal-500"
                        >
                          <option value="WR">WR</option>
                          <option value="QRF">QRF</option>
                          <option value="PPI">PPI</option>
                          <option value="PPI/SDC">PPI/SDC</option>
                          <option value="BOQ">BOQ</option>
                          <option value="SMART">SMART</option>
                          <option value="SDC">SDC</option>
                          <option value="SmartPlan - Revision">SmartPlan - Revision</option>
                          <option value="REVISÃO WR">REVISÃO WR</option>
                          <option value="REVISÃO QRF">REVISÃO QRF</option>
                          <option value="REVISÃO PPI">REVISÃO PPI</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Status Geral:
                        </label>
                        <select
                          value={formStatus}
                          onChange={(e) => setFormStatus(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500 font-bold"
                        >
                          <option value="Finalizado">Finalizado</option>
                          <option value="Em produção">Em produção</option>
                          <option value="Pendente">Pendente</option>
                          <option value="Pendente - Dúvida">Pendente - Dúvida</option>
                          <option value="Documentação paralisada">Documentação paralisada</option>
                          <option value="Demanda cancelada">Demanda cancelada</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Regional:
                        </label>
                        <input
                          type="text"
                          value={formRegional}
                          onChange={(e) => setFormRegional(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Tipo Site:
                        </label>
                        <input
                          type="text"
                          value={formTipoSite}
                          onChange={(e) => setFormTipoSite(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block font-bold text-slate-700 mb-1">
                          Executor Responsável:
                        </label>
                        <input
                          type="text"
                          value={formExecutor}
                          onChange={(e) => setFormExecutor(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Intervenção Claro
                      </span>
                      <p className="font-mono font-black text-slate-900 text-base">
                        {row.intervencaoClaro || '—'}
                      </p>
                    </div>

                    <div className="p-4 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Documentação / Tipo
                      </span>
                      <p className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-800 font-mono text-xs">
                          {row.tipoDoc || 'WR'}
                        </span>
                        <span className="text-slate-500 text-xs">({currentDocGroup})</span>
                      </p>
                    </div>

                    <div className="p-4 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Regional & Tipo de Site
                      </span>
                      <p className="font-bold text-slate-800 text-sm">
                        {row.regional || '—'} • {row.tipoSite || '—'}
                      </p>
                    </div>

                    <div className="p-4 bg-white border border-slate-200/90 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Executor Atribuído
                      </span>
                      <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                        <HardHat className="w-4 h-4 text-teal-600" />
                        <span>{currentExecutor || 'Não atribuído'}</span>
                      </p>
                    </div>
                  </div>
                )}

                {/* Documentation Status Quick Cards */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-4 h-4 text-teal-600" />
                      <span>Status da Documentação Técnica</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('docs')}
                      className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1 cursor-pointer"
                    >
                      <span>Ver detalhes</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {/* WR */}
                    <div className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-1">
                      <span className="text-[10px] font-bold text-indigo-900">WR</span>
                      <p className="text-xs font-black text-indigo-950">
                        {safeTipoDoc.includes('WR') ? row.status || 'Pendente' : docWrStatus}
                      </p>
                      {getDocExecutorDisplay('WR') !== '—' && (
                        <p className="text-[10px] text-indigo-700 truncate font-semibold">
                          {getDocExecutorDisplay('WR')}
                        </p>
                      )}
                    </div>

                    {/* QRF */}
                    <div className="p-3 rounded-xl bg-cyan-50/50 border border-cyan-200 space-y-1">
                      <span className="text-[10px] font-bold text-cyan-900">QRF</span>
                      <p className="text-xs font-black text-cyan-950">
                        {safeTipoDoc.includes('QRF') ? row.status || 'Pendente' : docQrfStatus}
                      </p>
                      {getDocExecutorDisplay('QRF') !== '—' && (
                        <p className="text-[10px] text-cyan-700 truncate font-semibold">
                          {getDocExecutorDisplay('QRF')}
                        </p>
                      )}
                    </div>

                    {/* PPI */}
                    <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200 space-y-1">
                      <span className="text-[10px] font-bold text-emerald-900">PPI</span>
                      <p className="text-xs font-black text-emerald-950">
                        {safeTipoDoc.includes('PPI') ? row.status || 'Pendente' : docPpiStatus}
                      </p>
                      {getDocExecutorDisplay('PPI') !== '—' && (
                        <p className="text-[10px] text-emerald-700 truncate font-semibold">
                          {getDocExecutorDisplay('PPI')}
                        </p>
                      )}
                    </div>

                    {/* BOQ */}
                    <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 space-y-1">
                      <span className="text-[10px] font-bold text-amber-900">BOQ</span>
                      <p className="text-xs font-black text-amber-950">
                        {docBoqStatus}
                      </p>
                      {(row.fields?.['Faturamento'] || currentExecutor) && (
                        <p className="text-[10px] text-amber-700 truncate font-semibold">
                          {row.fields?.['Faturamento'] || currentExecutor}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Recent Attached Files Summary */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-teal-600" />
                      <span>Arquivos do Site ({attachedFilesList.length})</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('arquivos')}
                      className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1 cursor-pointer"
                    >
                      <span>Gerenciar arquivos</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {attachedFilesList.length === 0 ? (
                    <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                      Nenhum arquivo anexado a este site.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {attachedFilesList.slice(0, 3).map((f) => (
                        <div key={f.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2 truncate">
                            <FileText className="w-4 h-4 text-teal-600 shrink-0" />
                            <span className="font-semibold text-slate-800 truncate">{f.name}</span>
                          </div>
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold text-[11px] flex items-center gap-1 shrink-0"
                          >
                            <Download className="w-3 h-3" />
                            <span>Baixar</span>
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: DOCUMENTAÇÃO (WR, QRF, PPI, BOQ, SMART, SDC) */}
            {activeTab === 'docs' && (
              <div className="space-y-4">
                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                  <div className="border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-teal-600" />
                      <span>Status Detalhado por Documentação Técnica</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Controle individual de WR, QRF, PPI, BOQ e status de revisão da planilha Ericsson.
                    </p>
                  </div>

                  {/* WR Section */}
                  <div className="p-4 rounded-xl bg-indigo-50/40 border border-indigo-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-mono font-bold text-xs">
                          WR
                        </span>
                        <span className="font-bold text-indigo-950 text-xs">
                          Work Report / Relatório Técnico
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-black bg-indigo-100 text-indigo-900 border border-indigo-300">
                        {safeTipoDoc.includes('WR') ? row.status || 'Pendente' : docWrStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-indigo-800 uppercase">Executor WR:</span>
                        <p className="font-semibold text-slate-900">{getDocExecutorDisplay('WR')}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-indigo-800 uppercase">WR Rev. Plan:</span>
                        <p className="font-medium text-slate-800">{getDocPlanDisplay('WR')}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-indigo-800 uppercase">WR Entregue:</span>
                        <p className="font-medium text-slate-800">{getDocDeliveryDisplay('WR')}</p>
                      </div>
                      {row.fields?.['MOTIVO'] && (
                        <div className="sm:col-span-3">
                          <span className="text-[10px] font-bold text-indigo-800 uppercase">Motivo de Revisão:</span>
                          <p className="font-medium text-slate-700 bg-white p-2 rounded-lg border border-indigo-100 mt-0.5">
                            {row.fields['MOTIVO']}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* QRF Section */}
                  <div className="p-4 rounded-xl bg-cyan-50/40 border border-cyan-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-cyan-600 text-white font-mono font-bold text-xs">
                          QRF
                        </span>
                        <span className="font-bold text-cyan-950 text-xs">
                          Qualificação Radiofrequência
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-black bg-cyan-100 text-cyan-900 border border-cyan-300">
                        {safeTipoDoc.includes('QRF') ? row.status || 'Pendente' : docQrfStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-cyan-800 uppercase">Executor QRF:</span>
                        <p className="font-semibold text-slate-900">{getDocExecutorDisplay('QRF')}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-cyan-800 uppercase">QRF Rev. Plan:</span>
                        <p className="font-medium text-slate-800">{getDocPlanDisplay('QRF')}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-cyan-800 uppercase">QRF Entregue:</span>
                        <p className="font-medium text-slate-800">{getDocDeliveryDisplay('QRF')}</p>
                      </div>
                      {row.fields?.['MOTIVO DE REVISÃO DO QRF'] && (
                        <div className="sm:col-span-3">
                          <span className="text-[10px] font-bold text-cyan-800 uppercase">Motivo de Revisão QRF:</span>
                          <p className="font-medium text-slate-700 bg-white p-2 rounded-lg border border-cyan-100 mt-0.5">
                            {row.fields['MOTIVO DE REVISÃO DO QRF']}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* PPI Section */}
                  <div className="p-4 rounded-xl bg-emerald-50/40 border border-emerald-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-mono font-bold text-xs">
                          PPI
                        </span>
                        <span className="font-bold text-emerald-950 text-xs">
                          Projeto Padrão de Instalação
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                        {safeTipoDoc.includes('PPI') ? row.status || 'Pendente' : docPpiStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-emerald-800 uppercase">Executor PPI:</span>
                        <p className="font-semibold text-slate-900">{getDocExecutorDisplay('PPI')}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-emerald-800 uppercase">PPI Rev. Plan:</span>
                        <p className="font-medium text-slate-800">{getDocPlanDisplay('PPI')}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-emerald-800 uppercase">PPI Entregue:</span>
                        <p className="font-medium text-slate-800">{getDocDeliveryDisplay('PPI')}</p>
                      </div>
                      {row.fields?.['MOTIVO DE REVISÃO DO PPI'] && (
                        <div className="sm:col-span-3">
                          <span className="text-[10px] font-bold text-emerald-800 uppercase">Motivo de Revisão PPI:</span>
                          <p className="font-medium text-slate-700 bg-white p-2 rounded-lg border border-emerald-100 mt-0.5">
                            {row.fields['MOTIVO DE REVISÃO DO PPI']}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* BOQ Section */}
                  <div className="p-4 rounded-xl bg-amber-50/40 border border-amber-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-mono font-bold text-xs">
                          BOQ
                        </span>
                        <span className="font-bold text-amber-950 text-xs">
                          Bill of Quantities / Faturamento
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                        {docBoqStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-amber-800 uppercase">Faturamento:</span>
                        <p className="font-medium text-slate-800">{row.fields?.['Faturamento'] || '—'}</p>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-amber-800 uppercase">Fat. Adicional:</span>
                        <p className="font-medium text-slate-800">{row.fields?.['Fat. Adicional'] || '—'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: TODOS OS CAMPOS DA PLANILHA */}
            {activeTab === 'campos' && (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-teal-600" />
                      <span>Todos os Campos da Planilha ({allFieldEntries.length})</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Valores exatos importados da aba Site list da Ericsson.
                    </p>
                  </div>

                  {/* Search filter for fields */}
                  <div className="relative min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={fieldsSearch}
                      onChange={(e) => setFieldsSearch(e.target.value)}
                      placeholder="Filtrar campos..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {filteredFields.map(({ key, value }) => {
                    const isFilled = Boolean(value && String(value).trim() !== '' && String(value).trim() !== '-');
                    return (
                      <div
                        key={key}
                        className={`p-2.5 rounded-xl border text-xs flex flex-col gap-0.5 transition-colors ${
                          isFilled
                            ? 'bg-slate-50/70 border-slate-200/80 hover:bg-teal-50/30 hover:border-teal-200'
                            : 'bg-white border-slate-100 text-slate-400'
                        }`}
                      >
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate" title={key}>
                          {key}
                        </span>
                        <span className={`font-mono text-xs break-words ${isFilled ? 'text-slate-900 font-semibold' : 'text-slate-300 italic'}`}>
                          {value || '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB: ARQUIVOS */}
            {activeTab === 'arquivos' && (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-teal-600" />
                      <span>Arquivos Anexados ({attachedFilesList.length})</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Documentos e relatórios salvos diretamente neste site (sem subpastas).
                    </p>
                  </div>

                  {/* Upload button */}
                  {canEdit && (
                    <label className="px-3 py-1.5 bg-[#1E8E8D] hover:bg-[#177271] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isUploadingFile ? 'Enviando...' : '+ Anexar Arquivo'}</span>
                      <input
                        type="file"
                        onChange={handleFileUpload}
                        disabled={isUploadingFile}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {attachedFilesList.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl space-y-2 bg-slate-50/50">
                    <Paperclip className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="font-bold text-slate-700 text-xs">Nenhum arquivo enviado ainda</p>
                    <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                      Anexe relatórios técnicos, fotos ou plantas para este site.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attachedFilesList.map((f) => (
                      <div
                        key={f.id}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:bg-teal-50/40 hover:border-teal-200 transition-all text-xs"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="truncate">
                            <p className="font-bold text-slate-900 truncate">{f.name}</p>
                            <p className="text-[10px] text-slate-400">
                              Enviado por {f.uploadedBy || 'Equipe'} •{' '}
                              {new Date(f.uploadedAt).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>

                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Baixar</span>
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: HISTÓRICO */}
            {activeTab === 'historico' && (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-4 h-4 text-teal-600" />
                    <span>Histórico de Alterações ({historyList.length})</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Registro de auditoria com data, autor e modificações realizadas neste site.
                  </p>
                </div>

                {historyList.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                    Nenhuma alteração registrada recentemente neste site.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {historyList.map((entry) => (
                      <div key={entry.id} className="relative space-y-1 text-xs">
                        <div className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-teal-500 border-2 border-white shadow-2xs" />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900">
                            {entry.user || 'Usuário'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(entry.timestamp).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <p className="font-semibold text-teal-900 text-[11px]">
                          {entry.action}
                        </p>
                        {entry.details && (
                          <p className="text-slate-600 text-[11px]">
                            {entry.details}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* =====================================================================
              3. DRAWER FOOTER
             ===================================================================== */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 text-xs">
            <span className="text-slate-500">
              Site <strong>{row.intervencaoClaro}</strong> • Última atualização:{' '}
              {new Date(row.updatedAt || Date.now()).toLocaleDateString('pt-BR')}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Fechar
              </button>
              {canEdit && isEditing && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="px-5 py-2 rounded-xl font-bold bg-[#1E8E8D] hover:bg-[#177271] text-white shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Salvando...' : 'Salvar Alterações'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
