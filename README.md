# Alva

**Alva** é um IDE web, rápido e moderno, para desenvolvimento ABAP — uma alternativa ao Eclipse ADT.
Corre localmente (servidor Node + browser) e fala com o sistema SAP através da mesma API REST
que o Eclipse usa (ADT, `/sap/bc/adt`).

*Alva* é a primeira luz do dia: o que vem depois de um eclipse.

```
Browser (React + Monaco)  ──►  servidor local Node (127.0.0.1)  ──►  SAP (ADT REST /sap/bc/adt)
   editor, abaplint (worker)        sessão ADT, locks, transportes
```

## O que já faz

| | |
|---|---|
| **Abrir objetos** | `Ctrl+Shift+A` (ou `Ctrl+P`): pesquisa com wildcard implícito, filtros por tipo (classes, interfaces, programas, funções, CDS, tabelas, pacotes) e objetos recentes |
| **Explorador de pacotes** | pacotes favoritos por sistema, subpacotes, objetos agrupados por tipo |
| **Editor** | Monaco (o motor do VS Code): multi-cursor, procurar/substituir, minimapa, *sticky scroll*, *bracket colorization*, temas claro/escuro |
| **Análise enquanto escreves** | [abaplint](https://abaplint.org) num web worker: erros de sintaxe, instruções obsoletas, código inalcançável… sem ir ao sistema |
| **Verificação SAP** | `Ctrl+F2` e, por omissão, ao gravar |
| **Gravar / ativar** | `Ctrl+S` / `Ctrl+F3`, com lock → escrita → unlock, escolha da **ordem de transporte** quando o pacote o exige, deteção de **conflitos** (o objeto mudou no sistema desde que o abriste) |
| **Navegação** | `F3`/`Ctrl+Click` para a definição (também noutros objetos), `Alt+F12` para espreitar, `Ctrl+O` para ir para um método/símbolo |
| **Completar código** | `Ctrl+Space` e após `->`, `=>`, `~`, `-` (propostas do sistema SAP) |
| **Pretty Printer** | `Shift+F1` (definições do sistema) |
| **Classes** | alternar entre classe global, tipos locais, macros e classes de teste |
| **Outline** | estrutura viva (classes, métodos, atributos, FORMs, eventos), segue o cursor |
| **Objetos inativos** | lista e ativação em massa (`Ctrl+Shift+F3`) |
| **Paleta de comandos** | `Ctrl+Shift+P`, todos os atalhos em `Ctrl+K` |
| **Sistema demo** | experimenta tudo sem SAP: um sistema em memória com classes, interface, programas, testes ABAP Unit e transportes |

## Começar

Requer Node.js 20+.

```bash
npm install
npm run build
npm start            # http://127.0.0.1:3417
```

Desenvolvimento (recarrega ao gravar):

```bash
npm run dev          # API em :3417, interface em http://localhost:5173
```

Variáveis de ambiente: `PORT` (3417), `HOST` (`127.0.0.1`).

## Ligar a um sistema SAP

No ecrã inicial indica o URL (`https://servidor:porta`), mandante, utilizador e palavra-passe.

- O serviço ICF `/sap/bc/adt` tem de estar ativo (transação `SICF`) — é o mesmo que o Eclipse ADT usa.
- O utilizador precisa das autorizações habituais de desenvolvimento ADT (`S_ADT_RES`, `S_DEVELOP`, `S_TCODE` para `SE80`, …).
- Sistemas com certificado autoassinado ou de CA interna: marca *Aceitar certificados autoassinados*.

### Segurança

- O servidor escuta só em `127.0.0.1` por omissão. Não o exponhas na rede sem autenticação à frente:
  quem chegar ao servidor usa a tua sessão SAP.
- A palavra-passe vai apenas para o servidor local, que a usa para abrir a sessão ADT e a mantém só em memória.
  O browser guarda os perfis dos sistemas (URL, mandante, utilizador), nunca a palavra-passe.
- A API exige um cabeçalho próprio em todos os pedidos e o cookie de sessão é `HttpOnly` e `SameSite=Strict`.

## Arquitetura

```
src/
  server/            Express: sessões, REST API
    backend/adt.ts   ligação a um sistema real (biblioteca abap-adt-api)
    backend/demo.ts  sistema demo em memória (verificação de sintaxe real via abaplint)
  client/            React + Monaco
    ide.ts           abrir/gravar/ativar/verificar, modelos e marcadores do Monaco, providers ABAP
    lint.worker.ts   abaplint num web worker (diagnósticos + outline)
    commands.ts      comandos e atalhos de teclado
  shared/            tipos da API e análise abaplint (usada pelo browser e pelo sistema demo)
```

Cada objeto aberto é um *model* do Monaco (URI = URI ADT da fonte), por isso desfazer/refazer e a posição
são mantidos por separador, e "ir para a definição" noutro objeto abre-o num novo separador.

## Testes

```bash
npm run typecheck
npm test             # API e análise (Vitest)
npm run build && npm run test:e2e   # browser (Playwright) contra o sistema demo
```

## Próximos passos

- Executar testes ABAP Unit e mostrar resultados/cobertura
- ATC (verificações de qualidade) integradas nos problemas
- Criar objetos (classe, programa, interface, CDS) e pacotes
- Vista de transportes (as minhas ordens, libertar, objetos)
- Onde é usado (*where-used*) e *rename* refactoring
- Documentação ABAP ao passar o rato (*hover*)
- Editores de DDIC (elementos de dados, domínios) e CDS com completar
- Debugger ABAP
- Comparar versões / histórico (revisions)
- Integração abapGit
- App desktop (Tauri/Electron) com SSO (certificados X.509 / SAML)

---

SAP e ABAP são marcas registadas da SAP SE. O Alva é um projeto independente, sem afiliação com a SAP.
