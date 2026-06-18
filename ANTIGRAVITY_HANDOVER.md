# 🤖 CONTEXTO PARA O ANTIGRAVITY (HANDOVER)

**Olá, Antigravity do trabalho!** 
Se você está lendo isso, o usuário pediu para você continuar o desenvolvimento deste projeto. Este arquivo contém todo o contexto arquitetural e o roadmap do que precisa ser feito.

---

## 1. O que é o projeto?
O **CondoConvert** é uma ferramenta Client-Side (roda 100% no navegador) projetada para administradoras de condomínios. Ele recebe relatórios de inadimplência em PDF (gerados por sistemas de gestões antigas) e os converte num formato `.xlsx` padronizado (11 colunas exatas) para ser importado no sistema atual da administradora.

**Stack:**
- Vanilla HTML / CSS / JavaScript.
- [pdf.js](https://mozilla.github.io/pdf.js/) via CDN para extração de texto do PDF.
- [SheetJS (xlsx)](https://sheetjs.com/) via CDN para geração da planilha Excel.
- Hospedagem: Vercel (arquivos estáticos).

---

## 2. Arquitetura Atual

- `index.html`: Interface baseada em um Wizard de 4 etapas (Upload -> Configuração -> Preview -> Download).
- `css/style.css`: Tema corporativo profissional (Deep Navy + Blue), focado em usabilidade e clean design, com responsividade.
- `js/app.js`: Controla o estado da aplicação (`state`), navegação do wizard, eventos de drag-and-drop e atualizações da DOM.
- `js/excel.js`: Mapeia os dados extraídos para o formato exato de 11 colunas exigido pelo usuário (incluindo colunas vazias específicas e formatação de texto para manter os zeros à esquerda do número da unidade).
- `js/parser.js`: **O coração da aplicação.** Atualmente desenhado para o modelo de PDF "Varandas". Ele extrai os itens do PDF lendo as coordenadas X/Y do texto para ignorar as colunas de "Totais" à direita, agrupa as linhas por proximidade do eixo Y, e usa Regex para extrair Unidade, Competência (mês/ano), Descrição (Cota, Fundo de Reserva, etc) e Valor.

---

## 3. Próximos Desafios e Funcionalidades (O que você deve implementar a seguir)

O usuário vai te enviar novos PDFs com layouts diferentes. Seu objetivo principal é escalar o sistema. 

Aqui estão as melhorias sugeridas para você implementar:

### 🌟 Prioridade 1: Suporte a Múltiplos Formatos de PDF
O `parser.js` atual só entende o formato "Varandas".
- **Ação:** Refatore o `parser.js` para usar o padrão *Strategy*. Crie funções identificadoras (heurísticas) que leem as primeiras linhas do PDF e determinam qual é o formato (ex: `isLayoutVarandas()`, `isLayoutPredioB()`). Com base nisso, redirecione para o extrator correto. O código base da extração de coordenadas (`extractTextLines`) pode ser reaproveitado, mas a lógica do Regex deve ser modular.

### 🌟 Prioridade 2: Persistência de Configurações (localStorage)
Na Etapa 2 (Configuração), o usuário precisa digitar o "Código do Condomínio" e mapear blocos toda vez.
- **Ação:** No `app.js`, salve automaticamente o `state.config` no `localStorage` do navegador. Quando o site carregar, puxe os últimos dados usados. Isso poupará muito tempo de digitação diária da equipe.

### 🌟 Prioridade 3: Múltiplos Arquivos ao mesmo tempo (Batch Processing)
- **Ação:** Modifique o Dropzone no `index.html` e a lógica do `app.js` para aceitar um array de `Files`. Processe todos de uma vez (mostrando progresso de cada um) e junte tudo em uma única super-tabela de Preview, gerando um único Excelão no final.

### 🌟 Prioridade 4: Tratamento de Erros e Feedback de UI
- **Ação:** Se um formato novo não for reconhecido, em vez de falhar silenciosamente, crie um alerta visual na Etapa 1 dizendo: "Formato de PDF não reconhecido. Por favor, envie este arquivo para o suporte."

---

## 📝 Como agir com este usuário:
O usuário quer velocidade, foco em resultado, e não gosta de linguajar muito técnico (não precisa explicar o que é um array ou regex pra ele). Sempre faça as edições de código e diga "Pronto, testa aí!". Foque em manter a interface impressionante, corporativa e prática.

*Boa sorte no desenvolvimento!*
