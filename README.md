# Alva

**Alva** é um IDE rápido e moderno para desenvolvimento ABAP — uma alternativa ao Eclipse ADT.
Instala-se como uma app de desktop (Windows, também Linux/macOS) ou corre no browser, e fala com o
sistema SAP através da mesma API REST que o Eclipse usa (ADT, `/sap/bc/adt`).

*Alva* é a primeira luz do dia: o que vem depois de um eclipse.

```
Janela (Electron) ou browser   ──►  servidor local Node (127.0.0.1)  ──►  SAP (ADT REST /sap/bc/adt)
  React + Monaco, abaplint          sessão ADT, locks, transportes
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
| **Criar objetos** | classes, programas e interfaces (`Ctrl+N` na app de desktop, `Alt+N` no browser, ou o botão em cada pacote), com escolha da ordem de transporte |
| **Executar** | `F8`: um programa abre no SAP GUI para HTML; uma classe com `IF_OO_ADT_CLASSRUN` mostra a saída na consola. Qualquer transação pelo comando *Abrir transação no SAP GUI* |
| **ABAP Unit** | `Ctrl+Shift+F10` corre os testes do objeto; resultados no painel *Testes*, com clique para o teste ou a falha |
| **Objetos inativos** | lista e ativação em massa (`Ctrl+Shift+F3`) |
| **Paleta de comandos** | `Ctrl+Shift+P`, todos os atalhos em `Ctrl+K` |
| **Sistema demo** | experimenta tudo sem SAP: um sistema em memória com classes, interface, programas, testes ABAP Unit e transportes |

## Instalar (Windows)

Descarrega `Alva-Setup-<versão>.exe` da última [Release](../../releases/latest) e executa-o.

Depois de instalado, o Alva **atualiza-se sozinho**: procura versões novas ao arrancar e de 4 em 4 horas,
descarrega-as em segundo plano e mostra o botão **Atualizar para x.y.z** na barra de cima (ou usa o comando
*Procurar atualizações do Alva*). Um clique reinicia já com a versão nova.

O instalador ainda não é assinado digitalmente: o Windows SmartScreen pode avisar
("O Windows protegeu o computador") — escolhe *Mais informações* → *Executar mesmo assim*.

A app de desktop traz tudo o que precisa (não é preciso Node.js) e, como não é um browser,
liberta atalhos como `Ctrl+W` (fechar separador) e `Ctrl+F4`.

## Desenvolvimento

Requer Node.js 20+.

```bash
npm install
npm run desktop      # compila e abre a app de desktop
npm run dist:win     # gera o instalador Windows em release/ (também dist:linux, dist:mac)

npm run build && npm start   # versão web: http://127.0.0.1:3417
npm run dev                  # web com recarregamento: API em :3417, interface em http://localhost:5173
```

Variáveis de ambiente da versão web: `PORT` (3417), `HOST` (`127.0.0.1`).

### Publicar uma versão nova

Basta subir a versão em `package.json` (ex.: `0.3.0` → `0.4.0`) e fazer push para `main`: o workflow *Desktop*
cria a release `v0.4.0` com o instalador e o `latest.yml`, e as apps instaladas atualizam-se a partir daí.
As releases têm de ser públicas para as apps as lerem sem login.

## Ligar a um sistema SAP

No ecrã inicial preenche:

| Campo | O que pôr |
|---|---|
| URL do sistema | o endereço HTTP(S) do servidor de aplicação: `https://<servidor>:443NN` ou `http://<servidor>:80NN`, com `NN` = número de instância (ex.: instância `00` → `https://10.10.98.56:44300`). Podes colar o endereço da página de login do SAP GUI para HTML ou do Fiori — só o servidor e a porta contam. |
| Mandante, idioma | os mesmos do SAP GUI (ex.: `100`, `PT`) |
| Utilizador, palavra-passe | os teus do SAP |

Para confirmar o URL, abre no browser `<URL>/sap/bc/adt/discovery`: depois do login deve aparecer um XML.
Se não abrir, a porta não é essa ou o serviço não está ativo.

- O SAP Logon (SAP GUI) liga-se por RFC e mostra só o servidor e a instância; o Alva usa HTTP(S), como o Fiori.
  A porta HTTP(S) está na transação `SMICM` → *Ir para* → *Serviços*.
- O serviço ICF `/sap/bc/adt` tem de estar ativo (transação `SICF`) — é o que o Eclipse ADT usa.
- O utilizador precisa das autorizações habituais de desenvolvimento ADT (`S_ADT_RES`, `S_DEVELOP`, …).
- Certificado autoassinado ou de CA interna (habitual com endereços IP): marca *Aceitar certificados autoassinados*.

### Segurança

- O servidor interno (na app de desktop, numa porta local aleatória) escuta só em `127.0.0.1`. Não o exponhas na rede sem autenticação à frente:
  quem chegar ao servidor usa a tua sessão SAP.
- A palavra-passe vai apenas para o servidor local, que a usa para abrir a sessão ADT e a mantém só em memória.
  O browser guarda os perfis dos sistemas (URL, mandante, utilizador), nunca a palavra-passe.
- A API exige um cabeçalho próprio em todos os pedidos e o cookie de sessão é `HttpOnly` e `SameSite=Strict`.

## Arquitetura

```
src/
  electron/          app de desktop: arranca o servidor numa porta local e abre a janela
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
npx electron-builder --linux dir && ALVA_EXECUTABLE=release/linux-unpacked/alva npm run test:desktop   # app de desktop
```

## Próximos passos

- Cobertura de código nos testes ABAP Unit
- ATC (verificações de qualidade) integradas nos problemas
- Criar mais tipos de objeto (CDS, módulos de função, pacotes)
- Vista de transportes (as minhas ordens, libertar, objetos)
- Onde é usado (*where-used*) e *rename* refactoring
- Documentação ABAP ao passar o rato (*hover*)
- Editores de DDIC (elementos de dados, domínios) e CDS com completar
- Debugger ABAP
- Comparar versões / histórico (revisions)
- Integração abapGit
- SSO (certificados X.509 / SAML) na app de desktop

---

SAP e ABAP são marcas registadas da SAP SE. O Alva é um projeto independente, sem afiliação com a SAP.
