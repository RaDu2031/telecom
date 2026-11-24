# Relatório de Auditoria e QA — Sistema Ameta Telecom (Nokia/TIM, Ericsson e Claro)

**Modo:** Auditoria / QA (Somente leitura e testes automatizados em memória — **nenhum arquivo de código de produção foi alterado**).  
**Framework de testes:** Vitest (`npx vitest run`) com Firestore e Firebase Auth 100% simulados em memória (`src/__tests__/mockFirestore.ts`). Nenhum dado real do Firestore foi lido ou modificado.  
**Data da auditoria:** 18/11/2026

---

## 1. Resumo Executivo

| Métrica | Quantidade |
| --- | ---: |
| **Total de itens avaliados** (61 testes automatizados Vitest + 9 verificações estáticas) | **70** |
| **✅ Aprovados (PASS)** | **36** |
| **❌ Falhas comprovadas (FAIL)** | **25** |
| **⚠️ Comportamentos duvidosos / alertas (WARN)** | **9** |

### Distribuição de Falhas (`❌`) e Alertas (`⚠️`) por Gravidade

| Gravidade | ❌ Falhas | ⚠️ Alertas | Total |
| --- | ---: | ---: | ---: |
| **Crítica** | 4 | 0 | **4** |
| **Alta** | 12 | 3 | **15** |
| **Média** | 8 | 4 | **12** |
| **Baixa** | 1 | 2 | **3** |

---

## 2. Tabela de Falhas e Alertas (Ordenada por Gravidade)

| Gravidade | Status | ID | Módulo | Resumo do Problema | Arquivo e Linha |
| --- | :---: | :---: | --- | --- | --- |
| **Crítica** | ❌ | E-07 | Segurança / Firestore Rules | `firestore.rules` permite que **Executor** e **Vistoriador** (via `canAccessNokia()` e `canAccessEricsson()`) executem **`delete`** em TODAS as planilhas (`nokia_sites`, `nokia_tssr`, `claro_sites`, `claro_engenharia`, `ericsson_sites`, `ericsson_engenharia`, pastas, arquivos, histórico). | `firestore.rules:102, 145-189` |
| **Crítica** | ❌ | E-08 | Segurança / Firestore Rules | Coleção `notificacoes` tem `allow read, write, delete: if isSignedIn();` — qualquer usuário autenticado (inclusive `aguardando` ou `bloqueado`) pode ler, alterar e apagar TODAS as notificações. | `firestore.rules:192-194` |
| **Crítica** | ❌ | A-07 | Isolamento / Demandas | `atribuirDemandaSites` com `vendor: 'CLARO_TIM'` e `targetScope: 'executor'` grava na coleção **`nokia_tssr`** em vez de `claro_engenharia` (mistura Claro com Nokia). | `src/services/dataService.ts:2911-2951` |
| **Crítica** | ❌ | A-08 | Isolamento / Equipes | `limparTodasLinhasEquipeDupla` com `vendor: 'CLARO_TIM'` limpa `claro_sites` e em seguida limpa **incondicionalmente `nokia_tssr`** sem checar `!isClaro`. | `src/services/dataService.ts:3852-3884` |
| **Alta** | ❌ | E-04 | Permissões | `canUserAccessVendor(user, 'CLARO_TIM')` retorna `true` na linha 361 **antes** de checar `isUserAguardando(user)` e ignora `user.plataforma` (libera Claro até para usuário `aguardando` ou exclusivo `ERICSSON`). | `src/types/telecom.ts:356-367` |
| **Alta** | ❌ | E-05 | Permissões | Usuário **sem plataforma definida** cai no fallback `|| 'NOKIA'` em `canUserAccessVendor`, liberando acesso silencioso à plataforma Nokia em vez de negar. | `src/types/telecom.ts:364` |
| **Alta** | ❌ | G-03 | Segurança / Auth | No primeiro acesso (`AuthGate`), a validação dos 3 dígitos do CPF usa `if (cleanCpf.length >= 3 && cpf3DigitsInput.length === 3)` — se o usuário deixar o campo vazio ou digitar 1–2 dígitos, **a verificação do CPF é completamente pulada**. | `src/components/AuthGate.tsx:220-228` |
| **Alta** | ❌ | G-02 | Segurança / Credenciais | Senha padrão `'ameta2026'` hardcoded em 6 pontos do frontend (`AdminAccessPanel.tsx`), exposta no bundle JavaScript público. | `src/components/AdminAccessPanel.tsx:223, 975, 993, 1385, 1934, 2787` |
| **Alta** | ❌ | B-09 | Importação / Validação | `validarCompatibilidadePlanilha` retorna `shouldBlock: false` imediatamente quando `targetType === 'CLARO_SITES'` ou `'CLARO_ENGENHARIA'`, permitindo importar planilhas Ericsson ou Nokia TSSR na aba Claro sem bloqueio nem aviso. | `src/utils/spreadsheetUtils.ts:376-383` |
| **Alta** | ❌ | B-10 | Importação / Validação | Bloqueio de planilha Claro na aba `NOKIA_SITES` só inspeciona colunas exclusivas (`CRQ`, `NDPd`, `Informações p/ NF`) se `input` for `string[]`; ao passar `ArrayBuffer` (arquivo `.xlsx`) sem a palavra `"claro"` no nome, passa sem bloqueio. | `src/utils/spreadsheetUtils.ts:386-406` |
| **Alta** | ❌ | B-12 | Importação / Ericsson Eng | `parseEricssonEngineeringWorkbookBuffer` monta `columns` em ordem canônica, mas lê `row[cIdx]` usando o índice de `columns` em vez do índice real em `rawHeaders` — qualquer arquivo com colunas fora da ordem canônica desloca/corrompe os valores. | `src/utils/ericssonSpreadsheetUtils.ts:1138-1172` |
| **Alta** | ❌ | B-11 | Importação / Datas Ericsson | `formatEricssonCellValue` assume que toda string `XX/YY/ZZZZ` está no formato americano `MM/DD/YYYY` e inverte dia/mês — converte `"13/10/2026"` em `"10/13/2026"` (data inválida) e `"05/03/2026"` em `"03/05/2026"`. | `src/utils/ericssonSpreadsheetUtils.ts:32-39` |
| **Alta** | ❌ | C-07 | Demandas / Acionamentos | `limparTodasLinhasEquipeDupla` no Nokia/Claro limpa os campos da planilha, mas **não cancela** os acionamentos da equipe. Além disso, `handleDeleteDupla` em `App.tsx` chama `limparTodasLinhasEquipeDupla` antes de `limparTodasDemandas`, fazendo com que os acionamentos nunca sejam encontrados/cancelados. | `src/services/dataService.ts:3808-3850`, `src/App.tsx:2042-2059` |
| **Alta** | ❌ | C-09 | Demandas / Firestore | `desvincularDemandaSites` (Nokia/Claro) coloca todas as operações em um único `writeBatch` sem paginação (chunking) — falha se houver >500 documentos. | `src/services/dataService.ts:3340-3416` |
| **Alta** | ❌ | F-06 | Acionamentos / Claro | No efeito de atualização automática ao concluir acionamento (`App.tsx:1120`), quando `ac.vendor === 'CLARO_TIM'`, o código busca o site apenas em `sitesRef.current` (somente Nokia) e **nunca consulta `claroSites`**, exibindo `"Planilha não encontrada"`. | `src/App.tsx:1120-1135` |
| **Alta** | ❌ | E-06 | Perfis / Simulação | Em `App.tsx:1420-1463`, `canSeeSitesTab`, `canSeeEngenhariaTab`, `canSeeDuplasTab`, `canAccessDemandaExecutores` e `isGestorEngenharia` usam `|| isRealGestor` — ao simular "Ver como Executor/Vistoriador", as abas de gestor continuam visíveis. | `src/App.tsx:1420-1463` |
| **Alta** | ⚠️ | W-01 | Isolamento / Demandas | Em `limparTodosSitesDemanda` (`dataService.ts:3535`) e `desvincularDemandaSites` (`dataService.ts:3338`), quando `vendor === 'CLARO_TIM'` e `targetScope === 'executor'`, ambos atuam em `NOKIA_TSSR` e cancelam acionamento com vendor `'NOKIA'`. | `src/services/dataService.ts:3338-3377, 3535-3572` |
| **Alta** | ⚠️ | W-02 | Segurança / Privacidade | E-mails pessoais dos donos, 22+ nomes completos e e-mails corporativos de funcionários hardcoded no bundle cliente; além disso `AdminAccessPanel.tsx` exibe `CPF: {u.cpf}` na lista geral de usuários. | `src/types/telecom.ts:296, 1395+`, `src/components/AdminAccessPanel.tsx:1850-1854` |
| **Alta** | ⚠️ | W-03 | Telas / Troca de Vendor | `handleSwitchVendor` (`App.tsx:894-917`) não valida `canUserAccessVendor(user, vendor)` e não reseta `functionFilter`, `selectedSiteId` nem paginação ao trocar de plataforma. | `src/App.tsx:894-917` |
| **Média** | ❌ | A-09 | Isolamento / Claro | `isItemInClientScope` (`demandaSharedService.ts:575-582`) compara `norm === activeVendor` (`'NOKIA' === 'CLARO_TIM'` -> `false`), ocultando usuários/duplas cadastrados na plataforma `NOKIA` quando `activeVendor === 'CLARO_TIM'`. | `src/services/demandaSharedService.ts:575-582` |
| **Média** | ❌ | A-10 | Isolamento / Equipes | `vincularEmailsDupla`, `desvincularEmailsDupla`, `adicionarEquipeExcluida` e `removerEquipeExcluida` tratam `CLARO_TIM` no mesmo mapa/lista da `NOKIA` (`duplaEmailsMap` e `excludedDuplasNokia`), compartilhando exclusões entre as duas plataformas. | `src/services/dataService.ts:3662-3745` |
| **Média** | ❌ | B-04 | Importação / Abas | `parseExcelWorkbookBuffer` fixa `sheetName = 'Controle Geral'` para `CLARO_TIM`, mas para `NOKIA` mantém o nome arbitrário da aba do arquivo (ex.: `Aba1_Custom`), divergindo do `sheetName` fixo `'Controle Geral'` gravado no lote. | `src/utils/spreadsheetUtils.ts:1297-1298` |
| **Média** | ❌ | B-05 | Importação / Excel | `parseExcelWorkbookBuffer` não processa células mescladas (`worksheet['!merges']`), deixando vazias as linhas secundárias de intervalos mesclados. | `src/utils/spreadsheetUtils.ts:1286-1325` |
| **Média** | ❌ | B-07 | Importação / Detecção | `avaliarHeaders` / `detectarTipoPlanilha` lista apenas `['NOKIA_SITES', 'NOKIA_TSSR', 'ERICSSON_SITES', 'ERICSSON_ENGENHARIA']` — `CLARO_SITES` e `CLARO_ENGENHARIA` nunca são detectados (planilhas Claro com `CRQ`/`NDPd` caem como `NOKIA_SITES`). | `src/utils/spreadsheetUtils.ts:211-226` |
| **Média** | ❌ | C-08 | Demandas / Contagem | `demandaSharedService.atribuirDemanda` retorna `count = rawTokens.length` ignorando `updatedSitesCount`, inflando o contador quando `allowTransfer = false` pula sites já atribuídos ou tokens não existem. | `src/services/demandaSharedService.ts:1055` |
| **Média** | ❌ | D-02 | Acionamentos / ID | `buildAcionamentoId` usa `refId.indexOf('__')` (primeira ocorrência), gerando duplicação de segmento quando `siteId` contém `__` (ex.: `PRAON04__PRPNG02` vira `ERICSSON_PRAON04__PRPNG02__PRPNG02_VISTORIA`) ou quando `registroId` tem prefixo de aba (`Controle_Geral__SPSP01` vira `NOKIA_SPSP01__SPSP01_VISTORIA`). | `src/types/telecom.ts:1492-1510` |
| **Média** | ❌ | F-03 | Edição Inline | `syncSiteColumnUpdate` ao limpar `EQUIPE EXECUTANTE` (ex.: `"Sem Dupla"`) limpa `customFields['EQUIPE EXECUTANTE']`, `equipe` e `responsavelDemand`, mas **esquece de limpar `customFields['EQUIPE']`**, mantendo o site considerado demandado por `temEquipeDemandadaSite`. | `src/utils/spreadsheetUtils.ts:817-828` |
| **Média** | ⚠️ | W-04 | Importação / Coluna B | Em `parseExcelWorkbookBuffer:1309-1314`, se `record['SITE ID']` estiver vazio na linha, o valor da Coluna B (`rowSlice[1]`) é copiado para `record['SITE ID']` mesmo quando a coluna B não é `SITE ID`. | `src/utils/spreadsheetUtils.ts:1309-1314` |
| **Média** | ⚠️ | W-05 | Código morto / Claro | `dataService.importarSitesClaroEmLote` (L1686) diverge de `importarSitesNokiaEmLote` (usa `sheetName: 'Claro – Sites'` e `fields` em vez de `'Controle Geral'` e `customFields`). Embora a UI use `importarSitesNokiaEmLote`, o método divergente segue exportado. | `src/services/dataService.ts:1686-1750` |
| **Média** | ⚠️ | W-06 | Demandas / Runtime | `demandaSharedService.ts:817` contém `require('../utils-[#toast]')` (caminho inválido e CommonJS em bundle ESM), silenciado por `try/catch {}`. | `src/services/demandaSharedService.ts:817` |
| **Média** | ⚠️ | W-07 | Perfis / Colunas | Para `effectiveRole === 'Executor'` na aba Sites (`App.tsx:3445-3462`), `orderedSheetColumns` retorna **14 colunas** (enquanto `TSSR_EXECUTOR_VISIBLE_COLUMNS` tem 12 e `ERICSSON_EXECUTOR_VISIBLE_COLUMNS` tem 11). | `src/App.tsx:3445-3462` |
| **Baixa** | ❌ | D-09 | Acionamentos / Protocolo | Protocolo usa apenas `Math.floor(1000 + Math.random() * 9000)` + últimos 8 caracteres do `siteId`, sem verificação de colisão no Firestore (colide se o sufixo de 8 chars e o número aleatório coincidirem). | `src/services/dataService.ts:4642-4644` |
| **Baixa** | ⚠️ | W-08 | Visibilidade / Parâmetro | Em `App.tsx:2952`, `doesSiteMatchResponsible(s, activeTargetUser, (activeTargetUser as any).linkedTeams)` passa nomes de equipes no 3º parâmetro que espera `linkedEmails: string[]`. Funciona indiretamente via `activeTargetUser.linkedTeams`, mas polui `emailSet`. | `src/App.tsx:2952` |
| **Baixa** | ⚠️ | W-09 | Build / Bundle Size | `vite build` gera chunk principal de `3,48 MB` (`index-*.js`, 811 KB gzip) sem code-splitting, emitindo aviso de performance. | `vite.config.ts` / `dist/assets/index-*.js` |

---

## 3. Lista Completa de Testes Executados e Verificações Estáticas

### Área A — Isolamento entre Plataformas (`src/__tests__/A_isolation.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| A-01 | Isolamento | Importar sites `CLARO_TIM` grava só em `claro_sites` | Chamar `importarSitesNokiaEmLote` com 2 sites `CLARO_TIM` e inspecionar todas as coleções | 2 docs em `claro_sites` (`vendor='CLARO_TIM'`, `sheetName='Controle Geral'`), 0 em `nokia_sites` e `ericsson_*` | 2 docs em `claro_sites`, 0 em `nokia_sites` e `ericsson_*` | ✅ | `src/services/dataService.ts:1004-1140` | — |
| A-02 | Isolamento | Importar sites `NOKIA` grava só em `nokia_sites` | Chamar `importarSitesNokiaEmLote` com 2 sites `NOKIA` | 2 docs em `nokia_sites`, 0 em `claro_sites` e `ericsson_*` | 2 docs em `nokia_sites`, 0 nas demais | ✅ | `src/services/dataService.ts:1004-1140` | — |
| A-03 | Isolamento | Importar Ericsson Sites e Ericsson Engenharia nas coleções corretas | Chamar `importarSitesEricssonEmLote` e `importarEricssonEngenhariaEmLote` | 1 doc em `ericsson_sites`, 1 em `ericsson_engenharia`, 0 em Nokia/Claro | Exatamente conforme esperado | ✅ | `src/services/dataService.ts:1150-1247, 1409-1535` | — |
| A-04 | Isolamento | Importar TSSR Nokia e Claro Engenharia isoladamente | Chamar `importarTssrNokiaEmLote` e `importarEngenhariaClaroEmLote` | 1 doc em `nokia_tssr`, 1 em `claro_engenharia`, 0 em Sites | Exatamente conforme esperado | ✅ | `src/services/dataService.ts:1264-1388, 1780-1910` | — |
| A-05 | Isolamento | Listener `onNokiaSites` ignora `CLARO_TIM` e `onClaroSites` só lê `claro_sites` | Semear `nokia_sites` com 1 doc `NOKIA` + 1 `CLARO_TIM` e `claro_sites` com 1 doc; assinar `observarColecoesPlataforma` com filtro de `App.tsx` | `onNokiaSites` retorna só `TIM01`; `onClaroSites` retorna só `CLA01` | Retornou `['TIM01']` e `['CLA01']` | ✅ | `src/App.tsx:662-718`, `src/services/dataService.ts:500-620` | — |
| A-06 | Isolamento | Ferramenta `moverRegistrosClaroDeNokiaSites` move só `CLARO_TIM` com sufixo `__movido_N` | Semear `nokia_sites` (`nk_keep` + `claro_stuck`) e `claro_sites` (`claro_stuck`); verificar e mover | `nk_keep` preservado; `claro_stuck` movido como `claro_stuck__movido_1` e removido de `nokia_sites` | 1 movido, `nk_keep` intacto, `claro_stuck__movido_1` criado em `claro_sites` | ✅ | `src/services/dataService.ts:4945-5040` | — |
| A-07 | Isolamento | `atribuirDemandaSites` com `vendor='CLARO_TIM'` e `targetScope='executor'` | Semear `SITE_X` em `nokia_tssr` e `claro_engenharia`; atribuir executor no vendor `CLARO_TIM` | `nokia_tssr` permanece intocado | `nokia_tssr/SITE_X` recebeu `executor='Executor Claro'` (vazamento para Nokia) | ❌ | `src/services/dataService.ts:2911-2951` | **Crítica** |
| A-08 | Isolamento | `limparTodasLinhasEquipeDupla` com `vendor='CLARO_TIM'` | Semear `claro_sites` e `nokia_tssr` com mesma equipe; executar limpeza para `CLARO_TIM` | `nokia_tssr` permanece intocado | `nokia_tssr/tssr_1.equipe` foi zerado para `''` | ❌ | `src/services/dataService.ts:3852-3884` | **Crítica** |
| A-09 | Isolamento | `getRegisteredUsersForDemanda` em `CLARO_TIM` | Passar usuários com plataforma `NOKIA` e `AMBAS` para `activeVendor='CLARO_TIM'` | Ambos aparecem na lista de Claro | Apenas `AMBAS` apareceu; usuário `NOKIA` foi filtrado fora | ❌ | `src/services/demandaSharedService.ts:575-582` | **Média** |
| A-10 | Isolamento | `adicionarEquipeExcluida` para `CLARO_TIM` | Adicionar dupla excluída com `vendor='CLARO_TIM'`; ler `duplas_config/main` | Não poluir `excludedDuplasNokia` | Gravou em `excludedDuplasNokia` compartilhado com Nokia | ❌ | `src/services/dataService.ts:3716-3731` | **Média** |
| A-11 | Isolamento | Integridade de coleções gravadas na importação Claro | Importar 1 site Claro e listar todas as coleções não vazias | Somente `claro_sites` e `historico_importacoes` | Somente `claro_sites` e `historico_importacoes` | ✅ | `src/services/dataService.ts:1004-1140` | — |

### Área B — Importação e Planilhas (`src/__tests__/B_importacao.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| B-01 | Importação | 805 linhas -> 805 gravadas + histórico | Importar array com 805 `TelecomSite` via `importarSitesNokiaEmLote` | `totalGravados=805`, 805 docs em `nokia_sites`, 1 registro em `historico_importacoes` | 805 docs gravados e histórico com `totalLidas=805, totalAdicionadas=805` | ✅ | `src/services/dataService.ts:1004-1140` | — |
| B-02 | Importação | Duplicados com ID único + append-only sem sobrescrita | Importar 2 linhas com mesmo `siteId` e depois reimportar 1ª linha | 3 docs independentes com IDs únicos; registros anteriores preservados | 3 docs com IDs distintos, `PRIMEIRO` e `SEGUNDO` preservados | ✅ | `src/services/dataService.ts:1035-1095` | — |
| B-03 | Importação | Cabeçalho na linha 2, espaços, linhas vazias, `#N/A`, datas Excel, números | Gerar XLSX real com subtotal na linha 1, headers com espaços na linha 2, Date UTC, número e `#N/A` | 2 linhas válidas, `13/10/2026`, `'2'`, `'#N/A'`, linha vazia ignorada | Todos os campos extraídos exatamente conforme esperado | ✅ | `src/utils/spreadsheetUtils.ts:687-697, 1023-1117, 1273-1332` | — |
| B-04 | Importação | Multi-sheet + `sheetName` fixo `'Controle Geral'` em Nokia Sites | Parsear XLSX com 2 abas (`Aba1_Custom`, `Aba2_Custom`) no vendor `NOKIA` | `sheetName` fixo `'Controle Geral'` | Retornou `sheetName = 'Aba1_Custom'` (só fixa `'Controle Geral'` para `CLARO_TIM` no parser) | ❌ | `src/utils/spreadsheetUtils.ts:1297-1298` | **Média** |
| B-05 | Importação | Células mescladas (`!merges`) | Gerar XLSX com UF e Município mesclados entre linhas 2 e 3 | Linha 3 herdar `UF='MA'` da mesclagem | Linha 3 ficou com `uf = undefined` | ❌ | `src/utils/spreadsheetUtils.ts:1286-1325` | **Média** |
| B-06 | Importação | CSV sem nome de aba e colagem Excel (TSV Ctrl+V) | Chamar `parseClipboardOrCsvText` com TSV e CSV `;` | Sites parseados corretamente com `sheetName='Controle Geral'` | 2 sites TSV e 1 site CSV parseados corretamente | ✅ | `src/utils/spreadsheetUtils.ts:1163-1271` | — |
| B-07 | Detecção | `detectarTipoPlanilha` nos 5 tipos de planilha | Passar cabeçalhos típicos de Nokia Sites, TSSR, Ericsson Sites, Ericsson Eng e Claro (`CRQ`, `NDPd`, `Informações p/ NF`) | Identificar cada tipo corretamente, incluindo `CLARO_SITES` | 4 primeiros corretos; Claro retornou `'NOKIA_SITES'` (`CLARO_*` ausente do loop de pontuação) | ❌ | `src/utils/spreadsheetUtils.ts:211-226` | **Média** |
| B-08 | Detecção | Falso positivo de `"Oc Site Pre"` | Validar `['Oc Site Pre', 'SITE ID', 'UF']` contra `NOKIA_SITES` e `NOKIA_TSSR` | `shouldBlock: false` em ambos | `shouldBlock: false` em ambos | ✅ | `src/utils/spreadsheetUtils.ts:132-144, 363-443` | — |
| B-09 | Validação | Bloqueio de planilha Ericsson na aba `CLARO_SITES` | Chamar `validarCompatibilidadePlanilha` com headers Ericsson e alvo `CLARO_SITES` | `shouldBlock: true` | Retornou `shouldBlock: false` (bypass na linha 376) | ❌ | `src/utils/spreadsheetUtils.ts:376-383` | **Alta** |
| B-10 | Validação | Bloqueio de buffer XLSX Claro (nome genérico) na aba `NOKIA_SITES` | Passar `ArrayBuffer` com `CRQ`/`NDPd`/`Informações p/ NF` e nome `'planilha_nova.xlsx'` para `NOKIA_SITES` | `shouldBlock: true` | Retornou `shouldBlock: false` (checagem só aceita `string[]`) | ❌ | `src/utils/spreadsheetUtils.ts:386-406` | **Alta** |
| B-11 | Datas | `formatEricssonCellValue('13/10/2026')` | Passar data brasileira `DD/MM/YYYY` | Retornar `'13/10/2026'` | Retornou `'10/13/2026'` (inversão indevida mês/dia) | ❌ | `src/utils/ericssonSpreadsheetUtils.ts:32-39` | **Alta** |
| B-12 | Ericsson Eng | `parseEricssonEngineeringWorkbookBuffer` com colunas fora da ordem canônica | Gerar XLSX com headers `['Status', 'Tipo doc', 'Intervencao Claro', 'ASP', 'Meta']` | Mapear `intervencaoClaro='INT_999'`, `status='Finalizado'` | Retornou `intervencaoClaro='WR'` (colunas deslocadas pelo índice canônico) | ❌ | `src/utils/ericssonSpreadsheetUtils.ts:1138-1172` | **Alta** |
| B-13 | Parsers | `parseEricssonWorkbookBuffer` e `parseTssrWorkbookBuffer` | Parsear buffers válidos com linhas vazias e `TOTAL GERAL` | 1 linha válida em cada, vazias e totais ignorados | 1 linha válida em cada (`PRAON04__PRPNG02` e `SPSP10`) | ✅ | `src/utils/ericssonSpreadsheetUtils.ts:117-414`, `src/utils/tssrSpreadsheetUtils.ts:69-173` | — |

### Área C — Demandas e Responsáveis (`src/__tests__/C_demandas.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| C-01 | Demandas | Regra de EQUIPE vazia / `"Sem Dupla"` nos Sites | Testar `getEquipeSite`, `temEquipeDemandadaSite` e `doesSiteMatchEquipe` com vazia, preenchida e legado (`responsavelDemand` preenchido mas `EQUIPE` vazio) | Vazio = não demandado (`Sem Dupla`); preenchido = demandado | Comportamento 100% conforme a regra | ✅ | `src/utils/spreadsheetUtils.ts:1687-1765` | — |
| C-02 | Demandas | Atribuir Vistoriador (Nokia/Claro Sites) e Executor (TSSR) | Chamar `demandaSharedService.atribuirDemanda` para os 3 cenários | Campos atualizados + 3 acionamentos (2 `VISTORIA`, 1 `EXECUTOR`) | Todos os campos e 3 acionamentos gravados corretamente | ✅ | `src/services/demandaSharedService.ts:750-1065`, `src/services/dataService.ts:2704-3097` | — |
| C-03 | Demandas | Remover demanda (Nokia, Claro, Ericsson) inclusive `PRAON04__PRPNG02` e IDs com sufixo | Atribuir e depois chamar `removerDemanda` nos 4 docs | Limpar responsável/equipe/uids/emails e cancelar todos os 4 acionamentos com `destinatariosEmails: []` | Todos os 4 docs limpos e os 4 acionamentos com `status='Cancelado'` e `destinatariosEmails=[]` | ✅ | `src/services/demandaSharedService.ts:1100-1346`, `src/services/dataService.ts:3270-3421` | — |
| C-04 | Demandas | Reatribuir demanda Ericsson Eng para outro executor | Atribuir a Ana Paula e reatribuir a Carlos Eduardo | Acionamento não fica mais ativo para Ana Paula; fica `Aguardando aceite` para Carlos | 0 ativos para Ana Paula; 1 ativo (`Aguardando aceite`) para Carlos | ✅ | `src/services/dataService.ts:2844-2873, 4560-4633` | — |
| C-05 | Demandas | `targetScope` `'executor'` vs `'equipe'` | Atribuir ambos no site `SPSP99`, depois desvincular só `'executor'` | Cancelar apenas `EXECUTOR`; manter `VISTORIA` intacto | `EXECUTOR` = `Cancelado`, `VISTORIA` = `Aguardando aceite` | ✅ | `src/services/dataService.ts:3338-3418` | — |
| C-06 | Equipes | CRUD de vínculos de e-mail e equipes excluídas | Testar `vincularEmailsDupla`, `desvincularEmailsDupla`, `adicionarEquipeExcluida`, `removerEquipeExcluida` | Persistir e remover corretamente em `duplas_config/main` | Todas as 4 operações persistiram corretamente | ✅ | `src/services/dataService.ts:3662-3745` | — |
| C-07 | Equipes | `limparTodasLinhasEquipeDupla` no Nokia cancela acionamentos | Atribuir site `SPSP77` e chamar `limparTodasLinhasEquipeDupla` (`vendor='NOKIA'`) | Acionamento do site passar a `Cancelado` | Acionamento permaneceu `'Aguardando aceite'` (não foi cancelado) | ❌ | `src/services/dataService.ts:3808-3850` | **Alta** |
| C-08 | Demandas | `atribuirDemanda` com `allowTransfer=false` em site já atribuído | Tentar atribuir site já com `Diego / Vagner` usando `allowTransfer=false` | Retornar `count = 0` | Retornou `count = 1` (`rawTokens.length`) | ❌ | `src/services/demandaSharedService.ts:1055` | **Média** |
| C-09 | Demandas | `desvincularDemandaSites` com 505 documentos no Nokia | Ativar limite real de 500 ops/batch no mock e desvincular 505 sites | Executar em lotes ≤500 ops sem erro | Rejeitou com `Batch exceeds Firestore 500-operation limit (505 ops)` | ❌ | `src/services/dataService.ts:3380-3416` | **Alta** |

### Área D — Acionamentos (`src/__tests__/D_acionamentos.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| D-01 | Acionamentos | `buildAcionamentoId` para IDs simples | Testar NOKIA, CLARO_TIM e ERICSSON com `VISTORIA` e `EXECUTOR` | IDs determinísticos `{VENDOR}_{SITE}_{TIPO}` | Todos exatos | ✅ | `src/types/telecom.ts:1492-1510` | — |
| D-02 | Acionamentos | `buildAcionamentoId` com `__` em `registroId` (`PRAON04__PRPNG02` e `Controle_Geral__SPSP01`) | Chamar `buildAcionamentoId` passando `registroId` contendo `__` | Não duplicar segmento do `siteId` | Retornou `ERICSSON_PRAON04__PRPNG02__PRPNG02_VISTORIA` (duplicou `__PRPNG02`) | ❌ | `src/types/telecom.ts:1505-1508` | **Média** |
| D-03 | Acionamentos | Criação de novo acionamento | Chamar `salvarOuAtualizarAcionamento` para site inédito | `status='Aguardando aceite'`, protocolo `AC-NOK-...`, histórico com 1 evento | Criado exatamente conforme esperado | ✅ | `src/services/dataService.ts:4635-4699` | — |
| D-04 | Acionamentos | Recusado -> Reenviado | Alterar status para `Recusado` + `motivoRecusa` e reenviar mesma equipe | Volta para `Aguardando aceite`, limpa `motivoRecusa`, mantém protocolo, registra histórico | Tudo conforme esperado | ✅ | `src/services/dataService.ts:4560-4633` | — |
| D-05 | Acionamentos | Mesma equipe em andamento (e atualização de e-mails) | Colocar status `Aceito`; reenviar mesma equipe (mesmo e-mail e depois com e-mail extra) | Preserva `Aceito`; atualiza `destinatariosEmails` quando lista muda | Preservou `Aceito` e atualizou `destinatariosEmails` | ✅ | `src/services/dataService.ts:4580-4633` | — |
| D-06 | Acionamentos | Reatribuição para equipe diferente | Mudar equipe de `Magno / Mateus` para `Diego / Vagner` com status `Aceito` | Volta para `Aguardando aceite` e troca `destinatariosEmails` | Tudo conforme esperado | ✅ | `src/services/dataService.ts:4560-4633` | — |
| D-07 | Acionamentos | `cancelarAcionamento` | Cancelar acionamento existente | `status='Cancelado'`, `destinatariosEmails=[]`, evento no histórico | Tudo conforme esperado | ✅ | `src/services/dataService.ts:4701-4742` | — |
| D-08 | Acionamentos | `resolverDestinatariosEmails` | Passar mistura de Vistoriador, Executor, Coord Geral, Coord Eng, ADM e e-mail inexistente | Filtrar apenas o role compatível (`VISTORIA` -> Vistoriador, `EXECUTOR` -> Executor) | Filtrou com 100% de precisão | ✅ | `src/services/dataService.ts:4460-4550` | — |
| D-09 | Acionamentos | Unicidade de protocolo | Criar 2 sites com mesmo sufixo de 8 chars com `Math.random` fixado em `0.5` | Protocolos distintos (sem colisão) | Ambos receberam exatamente `AC-NOK-12345678-5500` | ❌ | `src/services/dataService.ts:4642-4644` | **Baixa** |
| D-10 | Acionamentos | `tipoDestinatario` por escopo | Atribuir Sites (`equipe`) e Engenharia (`executor`) | `VISTORIA` para Sites, `EXECUTOR` para Engenharia | Exatamente conforme esperado | ✅ | `src/services/dataService.ts:2720` | — |

### Área E — Perfis, Permissões e `firestore.rules` (`src/__tests__/E_F_G_perfis_telas_seguranca.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| E-01 | Perfis | Helpers de role (`normalizeUserRole`, `hasFullSpreadsheetAccess`, `isGestorRole`, `isEngineeringCoordinatorRole`) | Testar todos os 5 perfis + valor desconhecido | Classificação correta por perfil | Todos os 5 perfis classificados corretamente | ✅ | `src/types/telecom.ts:311-354` | — |
| E-02 | Perfis | Constantes de colunas visíveis do Executor | Verificar tamanho de `TSSR_EXECUTOR_VISIBLE_COLUMNS` e `ERICSSON_EXECUTOR_VISIBLE_COLUMNS` | 12 colunas TSSR, 11 colunas Ericsson Eng | 12 e 11 colunas respectivamente | ✅ | `src/types/telecom.ts:790-803, 1155-1167` | — |
| E-03 | Permissões | `canUserAccessVendor` para `NOKIA`, `ERICSSON`, `AMBAS` e `ADM` | Testar combinações de plataforma para usuários ativos | Respeitar plataforma e liberar ADM em todas | Todas as combinações corretas | ✅ | `src/types/telecom.ts:356-367` | — |
| E-04 | Permissões | `canUserAccessVendor` para `CLARO_TIM` com usuário `aguardando` ou exclusivo `ERICSSON` | Chamar `canUserAccessVendor(aguardando, 'CLARO_TIM')` e `(ericOnly, 'CLARO_TIM')` | Retornar `false` em ambos | Retornou `true` em ambos (early return na L361) | ❌ | `src/types/telecom.ts:361` | **Alta** |
| E-05 | Permissões | `canUserAccessVendor` para usuário sem plataforma | Usuário ativo com `plataforma`/`assignedPlatform`/`preferredVendor` vazios | Retornar `false` | Retornou `true` para `NOKIA` (fallback `\|\| 'NOKIA'`) | ❌ | `src/types/telecom.ts:364` | **Alta** |
| E-06 | Simulação | "Ver como Executor/Vistoriador" não vaza abas de gestor | Inspecionar definição de `canSeeDuplasTab` / `canAccessDemandaExecutores` em `App.tsx` | Depender apenas de `effectiveRole` | Contém `\|\| isRealGestor`, mantendo abas de gestor na simulação | ❌ | `src/App.tsx:1420-1463` | **Alta** |
| E-07 | Firestore Rules | Executor/Vistoriador não podem apagar planilhas | Auditar regras `nokia_sites`, `claro_sites`, `ericsson_sites` em `firestore.rules` | `delete` restrito a `isCoordinatorOrAdmin() \|\| isAdmin()` | `delete` permitido para `canAccessNokia()` e `canAccessEricsson()` (inclui Executor e Vistoriador) | ❌ | `firestore.rules:145, 160, 173` | **Crítica** |
| E-08 | Firestore Rules | `notificacoes` protegida contra `delete` irrestrito | Auditar bloco `match /notificacoes/{docId}` | Restringir `delete`/escrita a usuários liberados/gestores | `allow read, write, delete: if isSignedIn();` aberto a qualquer conta | ❌ | `firestore.rules:192-194` | **Crítica** |

### Área F — Telas, Funções, Exportação e Edge Cases (`src/__tests__/E_F_G_perfis_telas_seguranca.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| F-01 | Busca | `matchesSiteSingleTerm` com nulos, undefined e texto de 20.000 chars | Executar busca em objeto com campos `null`/`undefined` e string muito longa | Não lançar exceção e localizar termo | Encontrou termo sem erro | ✅ | `src/App.tsx:3182-3203` | — |
| F-02 | Datas/Células | `formatExcelCellValue` com `Invalid Date`, `null`, `undefined`, `\n` | Passar entradas extremas | Retornar `''` para inválidos e `DD/MM/YYYY` para datas válidas | Todos tratados corretamente | ✅ | `src/utils/spreadsheetUtils.ts:687-697` | — |
| F-03 | Edição Inline | `syncSiteColumnUpdate` (STATUS, NDPd, limpeza de equipe) | Atualizar `STATUS`, `NDPd` e limpar `EQUIPE EXECUTANTE` com `'Sem Dupla'` | Limpar também `customFields['EQUIPE']` | `STATUS` e `NDPd` OK; `customFields['EQUIPE']` permaneceu `'Magno / Mateus'` | ❌ | `src/utils/spreadsheetUtils.ts:817-828` | **Média** |
| F-04 | Exportação | `buildExportRows` com `orderedColumns` e colunas homônimas Claro (`ID. DETENTORA` vs `ID detentora`) | Montar linhas exportadas com colunas ordenadas | Ordem exata e separação entre `ID. DETENTORA` e `ID detentora` | Ordem e valores 100% corretos | ✅ | `src/utils/spreadsheetUtils.ts:699-759, 1346-1399` | — |
| F-05 | Ericsson Eng | Reprovados, estatísticas consolidadas e filtro por executor | Rodar `isEricssonRowReproved`, `computeEricssonConsolidatedStats`, `isEricssonRowAssignedToExecutor` | Detectar `Em correção`, calcular 100% WR e casar dupla com `/` | Todos corretos | ✅ | `src/utils/ericssonSpreadsheetUtils.ts:955-1091, 1291-1334` | — |
| F-06 | Acionamentos -> Planilha | Atualização automática de `SI Executed` ao concluir acionamento `CLARO_TIM` | Auditar `useEffect` em `App.tsx:1089-1140` | Buscar em `claroSites` quando `ac.vendor === 'CLARO_TIM'` | Busca apenas em `sitesRef.current` (somente Nokia) | ❌ | `src/App.tsx:1120-1134` | **Alta** |

### Área G — Segurança (`src/__tests__/E_F_G_perfis_telas_seguranca.test.ts`)

| ID | Módulo | O que foi testado | Passos | Resultado Esperado | Resultado Obtido | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| G-01 | Segurança | Ausência de funções de apagar planilhas/cadastros em massa | Inspecionar `dataService.ts`, `App.tsx`, `AdminAccessPanel.tsx` | Zero ocorrências de `zerarTodasPlanilhas`, `zerarEricssonPlanilhas`, `zerarClaroSites`, `zerarCadastros` | Nenhuma função de wipe em massa encontrada | ✅ | `src/services/dataService.ts`, `src/App.tsx`, `src/components/AdminAccessPanel.tsx` | — |
| G-02 | Segurança | Ausência de senhas hardcoded no frontend | Inspecionar `AdminAccessPanel.tsx` | Nenhuma senha padrão fixa no código cliente | `'ameta2026'` hardcoded em 6 linhas | ❌ | `src/components/AdminAccessPanel.tsx:223, 975, 993, 1385, 1934, 2787` | **Alta** |
| G-03 | Segurança | Bypass da checagem de 3 dígitos do CPF no 1º acesso | Inspecionar `handleFirstAccessSubmit` em `AuthGate.tsx` | Exigir sempre 3 dígitos válidos quando usuário tem CPF cadastrado | Condição `&& cpf3DigitsInput.length === 3` pula validação se campo vazio | ❌ | `src/components/AuthGate.tsx:220-228` | **Alta** |
| G-04 | Segurança | Ausência de CPFs formatados hardcoded em `telecom.ts` | Buscar regex `\d{3}\.\d{3}\.\d{3}-\d{2}` | Nenhum CPF hardcoded | Nenhum CPF hardcoded encontrado | ✅ | `src/types/telecom.ts` | — |

### Verificações Estáticas Adicionais (`⚠️` e Checagem de React Error #310)

| ID | Módulo | Verificação | Resultado | Status | Arquivo:Linha | Gravidade |
| --- | --- | --- | --- | :---: | --- | --- |
| W-01 | Isolamento | `desvincularDemandaSites` e `limparTodosSitesDemanda` com `CLARO_TIM` + `executor` | Operam em `NOKIA_TSSR` e cancelam acionamento com vendor `'NOKIA'` em vez de `'CLARO_TIM'` / `claro_engenharia`. | ⚠️ | `src/services/dataService.ts:3338-3377, 3535-3572` | **Alta** |
| W-02 | Privacidade | Dados pessoais em código-fonte e exibição de CPF | 22+ nomes/e-mails reais em `telecom.ts`; `AdminAccessPanel.tsx:1850` renderiza `CPF: {u.cpf}` (embora o salvamento novo grave em `privado/dados`, contas legadas com `cpf` no doc público exibem CPF na tabela). | ⚠️ | `src/types/telecom.ts:296, 1395+`, `src/components/AdminAccessPanel.tsx:1850-1854` | **Alta** |
| W-03 | Navegação | `handleSwitchVendor` não limpa todos os filtros nem valida permissão | Mantém `functionFilter`, `selectedSiteId` e página atual ao trocar de vendor; não chama `canUserAccessVendor`. | ⚠️ | `src/App.tsx:894-917` | **Alta** |
| W-04 | Importação | Fallback posicional da Coluna B em `parseExcelWorkbookBuffer` | Se `SITE ID` estiver vazio na linha, copia `rowSlice[1]` mesmo quando a coluna B não é `SITE ID`. | ⚠️ | `src/utils/spreadsheetUtils.ts:1309-1314` | **Média** |
| W-05 | Arquitetura | Método divergente `importarSitesClaroEmLote` | Continua presente usando `sheetName: 'Claro – Sites'` e `fields` em vez de `'Controle Geral'` e `customFields`. | ⚠️ | `src/services/dataService.ts:1686-1750` | **Média** |
| W-06 | Demandas | `require('../utils-[#toast]')` inválido | Chamada quebrada dentro de `try/catch` vazio em `atribuirDemanda`. | ⚠️ | `src/services/demandaSharedService.ts:817` | **Média** |
| W-07 | Perfis | Quantidade de colunas para `Executor` na tela Sites | `orderedSheetColumns` entrega 14 colunas em `App.tsx:3445-3462`, contra 12 colunas em `TSSR_EXECUTOR_VISIBLE_COLUMNS`. | ⚠️ | `src/App.tsx:3445-3462` | **Média** |
| W-08 | Visibilidade | Argumento incorreto em `doesSiteMatchResponsible` | `App.tsx:2952` passa `linkedTeams` no parâmetro `linkedEmails`. | ⚠️ | `src/App.tsx:2952` | **Baixa** |
| W-09 | Performance | Bundle único de 3,48 MB | `vite build` alerta chunk > 500 KB sem code-splitting. | ⚠️ | `vite.config.ts` | **Baixa** |
| — | React Hooks | Varredura de hooks após `return` antecipado (React Error #310) | Nenhum componente em `src/**/*.tsx` possui hook chamado após `return` condicional de nível superior (`App.tsx:5078` `if (!user)` está corretamente após todos os hooks). | ✅ | `src/App.tsx:5078`, `src/components/*.tsx` | — |

---

## 4. Auditoria Completa de `firestore.rules` (Coleção por Coleção)

> **Nota crítica sobre `canAccessNokia()` e `canAccessEricsson()` (`firestore.rules:47-55`):**  
> Essas funções verificam apenas `isReleased()` (`situacao in ['ativo', 'dono'] || accessReleased == true`) e a `plataforma` do usuário. **Elas NÃO verificam `role`!** Portanto, **qualquer `Executor` ou `Vistoriador` liberado** satisfaz `canAccessNokia()` ou `canAccessEricsson()`.

| Coleção | Ler (`read`) | Criar (`create`) | Atualizar (`update`) | Apagar (`delete`) | Risco / Alerta |
| --- | --- | --- | --- | --- | --- |
| `nokia_sites` (L143) | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar toda a planilha!** |
| `nokia_tssr` (L147) | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar TSSR!** |
| `nokia_pastas` (L150) | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar pastas!** |
| `nokia_arquivos` (L153) | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar arquivos!** |
| `claro_sites` (L158) | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar Claro Sites!** |
| `claro_engenharia` (L162) | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar Claro Eng!** |
| `claro_meta` (L165) | Qualquer `isSignedIn()` | Liberado Nokia/Ambas, Coord, ADM | Liberado Nokia/Ambas, Coord, ADM | **Liberado Nokia/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **ALTA: Executor/Vistoriador pode alterar/apagar metadados Claro.** |
| `ericsson_sites` (L171) | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | **Liberado Ericsson/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar Ericsson Sites!** |
| `ericsson_pastas` (L175) | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | **Liberado Ericsson/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar pastas Ericsson!** |
| `ericsson_files` (L178) | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | **Liberado Ericsson/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar arquivos Ericsson!** |
| `ericsson_arquivos` (L181) | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | **Liberado Ericsson/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar arquivos Ericsson!** |
| `ericsson_engenharia` (L184) | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | **Liberado Ericsson/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **CRÍTICA: Executor/Vistoriador pode apagar Ericsson Eng!** |
| `ericsson_reprovacoes` (L187) | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | Liberado Ericsson/Ambas, Coord, ADM | **Liberado Ericsson/Ambas (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **ALTA: Executor/Vistoriador pode apagar reprovações!** |
| `historico_importacoes` (L100) | Qualquer `isSignedIn()` | Liberado Nokia ou Ericsson, Coord, ADM | Liberado Nokia ou Ericsson, Coord, ADM | **Liberado Nokia ou Ericsson (inclui Executor e Vistoriador!)**, Coord, ADM | ❌ **ALTA: Executor/Vistoriador pode apagar histórico de auditoria!** |
| `notificacoes` (L192) | Qualquer `isSignedIn()` | Qualquer `isSignedIn()` | Qualquer `isSignedIn()` | **Qualquer `isSignedIn()` (mesmo `aguardando`/bloqueado!)** | ❌ **CRÍTICA: Leitura/escrita/exclusão global sem checar liberação ou role!** |
| `usuarios` (L58) | Próprio usuário, Coord ou ADM | Próprio usuário (bloqueia `role=='ADM'`/`accessReleased==true`), Coord ou ADM | Próprio (sem escalar privilégios), Coord ou ADM | Somente `isAdmin()` | ⚠️ `isCoordinatorOrAdmin()` pode criar/editar qualquer usuário (exceto se regra limitar escalonamento para ADM — não impede Coord de dar `role: 'ADM'` na L75!). |
| `usuarios/{uid}/privado/dados` (L89) | Próprio usuário ou `isAdmin()` | Próprio usuário ou `isAdmin()` | Próprio usuário ou `isAdmin()` | `false` (negado) | ✅ Bem protegido (somente dono do perfil ou ADM; sem delete). |
| `acionamentos` (L200) | Coord, ADM, ou destinatário em `destinatariosEmails` | Somente Coord ou ADM | Coord, ADM, ou destinatário (campos restritos a aceite/recusa/conclusão) | Somente `isAdmin()` | ✅ Bem protegido (Executor/Vistoriador não podem criar nem apagar). |
| `duplas_config` (L195) | Qualquer `isSignedIn()` | Somente Coord ou ADM | Somente Coord ou ADM | Somente Coord ou ADM | ✅ Adequado. |
| `chamados` (L105) | Somente `isAdmin()` ou autor (`criadoPorUid`) | Usuário liberado (`isReleased()`) | Somente `isAdmin()` ou autor | Somente `isAdmin()` | ✅ Adequado. |
| `app_meta` (L95) | Qualquer `isSignedIn()` | Somente Coord ou ADM | Somente Coord ou ADM | Somente Coord ou ADM | ✅ Adequado. |
| `audit_logs` (L115) | Somente `isAdmin()` | Qualquer `isSignedIn()` | `false` | `false` | ✅ Adequado (append-only). |

---

## 5. Resultados de Build, Lint e TypeScript

> Resultados após correção apenas nos fixtures dos novos testes em `src/__tests__/`:

| Comando | Status | Saída / Erros |
| --- | :---: | --- |
| `npm run lint` (`tsc --noEmit`) | ✅ **Exit 0** | Nenhum erro de TypeScript no projeto. |
| `npx tsc --noEmit` | ✅ **Exit 0** | Nenhum erro de compilação TypeScript. |
| `npm run build` (`vite build`) | ✅ **Exit 0** | Build concluído em ~15s (`1680 modules transformed`). **Aviso:** `dist/assets/index-*.js` tem `3.481,65 kB` (811,85 kB gzip) — acima do limite de 500 kB recomendado pelo Vite. |

---

## 6. Testes que NÃO Puderam Ser Executados Automaticamente (e Por Quê)

Os itens abaixo dependem de navegador real, DOM renderizado com interações complexas, Firebase Auth real, regras avaliadas no servidor Firestore ou inspeção visual e **não foram executados automaticamente** (estão cobertos passo a passo no `CHECKLIST_MANUAL.md`):

1. **Avaliação real das `firestore.rules` no Firebase Rules Emulator** — o ambiente não possui o Firebase Emulator Suite (`firebase-tools` + Java) configurado; a auditoria das regras foi feita por leitura integral de `firestore.rules` e asserções estáticas (E-07, E-08).
2. **Fluxo real de autenticação Firebase Auth (login, logout, reset de senha, bloqueio `aguardando`/`bloqueado`, alteração de perfil em tempo real entre duas abas)** — exige instância real do Firebase Auth + duas sessões simultâneas no navegador.
3. **Renderização visual em tela, layout, responsividade, scroll horizontal/sticky header, modal de resumo antes de gravar importação, menu lateral e comparação visual de contadores (menu vs tabela) + paginação na UI** — exige execução no browser (sem Playwright/jsdom configurado neste projeto).
4. **Download real de arquivos `.XLSX` / `.CSV` no navegador e abertura no Microsoft Excel** — `XLSX.writeFile` e `Blob`/`URL.createObjectURL` exigem download pelo browser; testamos a montagem das linhas e colunas (`buildExportRows`), mas não a abertura física no Excel.
5. **Upload real de anexos/pastas (vistorias, LOS, documentos obrigatórios de usuários) e exportação "alteradas do dia" / relatório diário pela interface** — depende de interação de UI e Storage/Firestore real.
6. **Teste de estresse de renderização com 805+ linhas na tabela virtual/paginada** — a gravação em lote de 805 linhas foi validada no `dataService` (B-01), mas fluidez de rolagem/digitação na tabela precisa ser conferida no navegador.
