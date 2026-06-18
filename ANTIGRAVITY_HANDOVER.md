# 🤖 CONTEXTO PARA O ANTIGRAVITY (HANDOVER)

**Olá, Antigravity do trabalho!** 
Se você está lendo isso, o usuário pediu para você continuar o desenvolvimento deste projeto. Este arquivo contém todo o contexto arquitetural atualizado e o roadmap do que precisa ser feito.

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

- `index.html`: Interface baseada em um Wizard de 4 etapas (Upload -> Configuração -> Preview -> Download). Já possui suporte a **Batch Upload** (vários PDFs ao mesmo tempo).
- `css/style.css`: Tema corporativo profissional (Deep Navy + Blue).
- `js/app.js`: Controla o estado da aplicação. **Já está salvando/puxando dados do localStorage** (Código do condomínio, dígitos da unidade, formato da data). Ele também consolida múltiplos PDFs em um único array de dados.
- `js/excel.js`: Mapeia os dados extraídos para o formato exato de 11 colunas exigido pelo usuário.
- `js/parser.js`: **O coração da aplicação (Padrão Strategy implementado).** 
  - Usa a função genérica `extractTextLines()` para transformar o PDF em blocos baseados na coordenada Y, isolando as colunas de "Totais" inúteis.
  - Possui a função roteadora inteligente `detectLayoutAndParse(lines)`.
  - Atualmente ele identifica o PDF de layout "Varandas" e o direciona para a função exclusiva `parseLinesVarandas(lines)`.
  - Se ele não identificar o PDF, retorna erro e a UI exibe o aviso perfeitamente.

---

## 3. Próximos Desafios (O que você deve implementar a seguir)

Sua missão principal a partir de agora é **escalar o suporte a novos formatos de PDF**. O usuário vai te enviar relatórios de condomínios novos com formatos textuais totalmente diferentes.

### 🌟 Como adicionar suporte a um novo formato de PDF:
1. **Analise o novo PDF enviado pelo usuário.** Extraia a lógica visual/textual de onde estão as unidades, competências, cotas e fundos de reserva.
2. **Crie uma nova função de parser** dentro de `parser.js` (Ex: `parseLinesPredioB(lines)`). 
3. **Crie uma Heurística de Detecção:** Ache padrões (headers únicos nas primeiras 20 linhas do PDF) que comprovem que o arquivo é daquele condomínio específico.
4. **Atualize o Roteador:** Insira o seu novo `if` em `detectLayoutAndParse(lines)`.
5. **Atenção aos Retornos:** Garanta que todas as novas funções criadas retornem estritamente o objeto padrão `{ entries: Array, units: Array, blocks: Array }` para não quebrar o preview e a geração do Excel.

---

## 📝 Como agir com este usuário:
O usuário quer velocidade, foco em resultado, e não gosta de linguajar muito técnico. Sempre faça as edições de código e diga "Pronto, testa aí!". Foque em manter a interface corporativa, clean e hiper-funcional.

*Boa sorte no desenvolvimento!*
