# Checklist de Conferência Manual (QA em Tela) — Ameta Telecom

Este checklist cobre tudo o que **não pode ser validado automaticamente via Vitest em memória** (interface visual, Firebase Auth real, comportamento em tempo real entre abas, downloads no Excel e experiência do usuário).

---

## 1. Login, Primeiro Acesso e Controle de Acesso (Firebase Auth Real)

- [ ] **1.1 Login válido:** Entrar com conta ativa (ADM, Coordenador Geral, Coordenador Engenharia, Vistoriador e Executor) e confirmar redirecionamento para a aba correta (`engenharia` para Executor, `sites` para Vistoriador/Gestores).
- [ ] **1.2 Primeiro acesso (atenção ao bug G-03):** Testar conta recém-criada com CPF cadastrado deixando o campo de "3 primeiros dígitos do CPF" **vazio** — confirmar se o sistema deixa avançar (bug relatado em G-03).
- [ ] **1.3 Conta `aguardando` ou `bloqueado`:** Entrar com usuário não liberado e confirmar que a tela de bloqueio aparece imediatamente e impede acesso às planilhas (atenção: testar se o botão `CLARO` aparece liberado indevidamente devido ao bug E-04).
- [ ] **1.4 Usuário sem plataforma definida:** Testar conta ativa sem `NOKIA`/`ERICSSON`/`AMBAS` marcada e verificar se aparece alerta "Sem plataforma" no painel de Acessos e o que carrega ao entrar (bug E-05).
- [ ] **1.5 Alteração de perfil em tempo real:** Abrir duas abas (Aba 1: ADM; Aba 2: Vistoriador). Na Aba 1, mudar o perfil do usuário para `Executor` ou `bloqueado` e verificar se a Aba 2 atualiza automaticamente sem precisar recarregar.
- [ ] **1.6 Logout:** Clicar em Sair e verificar se limpa sessão, sai do modo simulação e volta ao `AuthGate`.

---

## 2. Isolamento entre Plataformas (Nokia/TIM × Claro × Ericsson)

- [ ] **2.1 Troca de vendor no topo:** Alternar entre `NOKIA (TIM)`, `CLARO` e `ERICSSON`. Conferir:
  - Os filtros (busca, UF, status, coluna) são limpos?
  - O filtro de função (`functionFilter`, ex.: Finalizadas/Cancelados/Novos) e a página da tabela também voltam ao início? *(Atenção ao alerta W-03)*
- [ ] **2.2 Importação na aba Claro:** Importar uma planilha na aba `CLARO`, conferir o modal de resumo antes de gravar, confirmar gravação e trocar para `NOKIA (TIM)` — garantir que **nenhum** registro da Claro aparece na TIM.
- [ ] **2.3 Importação de arquivo errado (atenção aos bugs B-09 e B-10):**
  - Tentar importar uma planilha Ericsson estando na aba `CLARO` (verificar se o sistema bloqueia ou deixa passar).
  - Tentar importar uma planilha Claro renomeada para `teste.xlsx` (sem a palavra "claro") estando na aba `NOKIA (TIM)`.
- [ ] **2.4 Ferramenta "Mover registros da Claro que ficaram em nokia_sites" (somente ADM/Dono):** Abrir Painel de Acessos, clicar no botão, conferir a contagem listada, cancelar primeiro (não deve mover nada) e só confirmar digitando `MOVER` se houver registros reais a migrar.

---

## 3. Importação, Planilhas e Colar do Excel (Ctrl+V)

- [ ] **3.1 Resumo antes de gravar:** Selecionar arquivo `.xlsx` e conferir se o modal mostra total de linhas lidas, colunas detectadas e destino fixo antes do clique de confirmação.
- [ ] **3.2 Contagem exata na tela:** Importar uma planilha de teste (ex.: 50 ou 805 linhas) e verificar se:
  - Total exibido no contador `"X registros"` da tabela = linhas anteriores + linhas do arquivo.
  - O **Histórico de Importações** registra data/hora, nome do arquivo e quantidade correta.
- [ ] **3.3 Colar do Excel (Ctrl+V):** Copiar 5 linhas do Excel (com cabeçalho na linha 1 ou linha 2, células vazias e `#N/A`), colar na aba `Colar Ctrl+V`, conferir prévia e importar.
- [ ] **3.4 Células mescladas e datas:** Abrir um arquivo com células mescladas e datas brasileiras (`13/10/2026`) na Nokia, Claro e Ericsson e conferir visualmente se alguma data apareceu invertida (`10/13/2026`, bug B-11) ou se células mescladas ficaram em branco (bug B-05).
- [ ] **3.5 Planilha Ericsson Engenharia fora de ordem (bug B-12):** Se usar arquivo com ordem de colunas diferente do modelo padrão, conferir se os valores de `Intervencao Claro`, `Tipo doc`, `Status` e `Meta` caíram nas colunas corretas.

---

## 4. Tabelas, Filtros, Edição Inline, Contadores e Exportação

- [ ] **4.1 Contadores do menu/cards vs tabela:** Comparar os números nos badges/cards KPI (Total, Finalizadas, Pendentes, Engenharia, Abono, Sem Chaves, Novos) com a quantidade real de linhas exibida ao clicar em cada filtro.
- [ ] **4.2 Filtros por coluna e busca múltipla:** Buscar dois `SITE ID` separados por espaço (ex.: `MAALL01 MASIS01`), combinar com filtro de `UF` e `STATUS`, ordenar colunas e navegar entre páginas (paginação).
- [ ] **4.3 Edição inline:**
  - Como **ADM**: editar uma célula qualquer e um `STATUS`, recarregar a página (`F5`) e confirmar persistência.
  - Testar limpar `EQUIPE EXECUTANTE` inline digitando `Sem Dupla` e verificar se o site sai da lista de demandados *(atenção ao bug F-03)*.
  - Como **Vistoriador/Executor**: confirmar que não é possível editar colunas restritas além de `STATUS` (quando permitido).
- [ ] **4.4 Coluna `Meta` na Ericsson (Sites e Engenharia):** Alterar a `Meta` inline, filtrar por `Meta` (incluindo `(Sem Meta)`), recarregar a página e verificar se salvou no Firestore.
- [ ] **4.5 Exportação `.XLSX` e `.CSV`:**
  - Aplicar um filtro (ex.: `UF = MA`), clicar em **Exportar Planilha (.XLSX)**, abrir o arquivo no Excel e confirmar que: (a) só exportou os registros filtrados, (b) as colunas estão na ordem exata da tela (inclusive `ID. DETENTORA` vs `ID detentora` na Claro), (c) acentos e datas abriram legíveis.
  - Conferir exportação na Ericsson Sites e Ericsson Engenharia (incluindo coluna `Meta`).
- [ ] **4.6 Textos muito longos e layout visual:** Verificar células com observações longas (reticências + tooltip completo no hover), cabeçalho fixo (`sticky`) ao rolar verticalmente e ausência de quebra de layout em telas menores (1280px e mobile).

---

## 5. Demandas, Equipes/Duplas e Integração com Acionamentos

- [ ] **5.1 Demandar Vistoriador (Sites) e Executor (Engenharia):**
  - Na tela **Duplas & Demanda** (filtro `Sem Dupla`), atribuir 1 site Nokia, 1 site Claro e 1 site Ericsson (com `__` no ID, ex.: `PRAON04__PRPNG02`).
  - Na tela **Demandar Executores** (filtro `Sem Executor`), atribuir 1 item Nokia TSSR e 1 item Ericsson Engenharia.
  - Abrir o sistema de Acionamentos (ou Firestore Console -> coleção `acionamentos`) e confirmar que os acionamentos foram criados com `status = 'Aguardando aceite'`, `tipoDestinatario` correto (`VISTORIA` vs `EXECUTOR`) e apenas e-mails do perfil certo.
- [ ] **5.2 Remover demanda e reatribuir:**
  - Remover a demanda de 1 site em cada plataforma e conferir se o acionamento mudou para `Cancelado` com `destinatariosEmails: []`.
  - Reatribuir 1 site para outra equipe/executor e conferir que o anterior não vê mais o acionamento ativo.
- [ ] **5.3 Concluir acionamento na Claro (bug F-06):** Marcar um acionamento `CLARO_TIM` como `Concluído` e observar se aparece o toast `"Planilha não encontrada para o site ..."` enquanto logado como ADM/Coordenador.
- [ ] **5.4 Excluir equipe / "Zerar todas as equipes" (atenção ao bug C-07 e A-08):**
  - Confirmar que o botão **"Zerar todas as equipes"** limpa apenas responsáveis e **NÃO apaga nenhuma linha de planilha**.
  - Conferir se há qualquer botão de "Zerar Planilha" ou "Zerar Cadastros" em todo o sistema (**NÃO deve existir nenhum**).
- [ ] **5.5 Ericsson Reprovados:** Abrir painel de Reprovados, testar filtros de período (`7d`, `30d`, `60d`, `Todos`) e regional, registrar uma reprovação de teste e verificar atualização do ranking.

---

## 6. Perfis, Colunas, Simulação ("Ver como") e Notificações

- [ ] **6.1 Visão do Executor (conta real, não simulação):** Entrar com conta `Executor` real e confirmar:
  - Só enxerga aba Engenharia e apenas os sites/itens demandados a ele.
  - Na TSSR vê exatamente **12 colunas**; na Ericsson Engenharia vê **11 colunas**.
  - Não vê botões de importar, excluir planilha, painel de acessos ou duplas.
- [ ] **6.2 Visão do Vistoriador (conta real):** Entrar com conta `Vistoriador` real e confirmar que vê apenas aba `Meus Sites` (somente sites demandados à sua equipe) e não vê aba Engenharia nem botões de gestão.
- [ ] **6.3 Simulação "Ver como Executor / Vistoriador" (atenção ao bug E-06):** Como ADM, ativar a simulação de um Executor e verificar se as abas `Duplas & Demanda`, `Demandar Executores` e `Sites` continuam aparecendo no topo/sidebar.
- [ ] **6.4 Painel de Acessos e CPF:** Entrar como `Coordenador Geral` e `Coordenador Engenharia`, verificar se têm acesso ao Painel de Acessos e se o CPF de outros colaboradores aparece visível na listagem (alerta W-02).
- [ ] **6.5 Notificações (sino no topo):** Criar uma demanda, conferir o contador do sino, abrir a lista de notificações, marcar como lida e confirmar que o contador zera.
