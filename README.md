# 💸 Assistente Financeiro

App web pessoal para gestão de custos: lançamentos de receitas e despesas,
orçamento mensal por categoria, dashboard com gráfico e um **assistente de IA
baseado em regras** que orienta suas finanças — tudo sem custo e rodando em
site estático no **GitHub Pages**.

> Roda em **modo local** (dados no navegador via `localStorage`) enquanto o
> `firebase-config.js` tiver placeholders. Ao preencher com um projeto Firebase
> real, passa a usar **login + Firestore** automaticamente, com dados privados
> por usuário.

## Funcionalidades

- **Login/cadastro** com e-mail e senha (Firebase Authentication) + **allowlist**
  (só e-mails autorizados entram).
- **Lançamentos**: receitas e despesas com data, valor, categoria e descrição.
- **Categorias** editáveis (crie as suas: Pets, Assinaturas, etc.).
- **Orçamento mensal** por categoria, com barra de progresso e alerta de estouro.
- **Dashboard**: receitas, despesas, saldo e gráfico de gastos por categoria.
- **Relatórios**: histórico de 6 meses (receitas × despesas × saldo), comparativo
  com o mês anterior por categoria e insights de tendência.
- **Metas de economia**: defina um alvo (ex.: reserva de R$ 5.000) e registre
  aportes manuais; o app acompanha o progresso.
- **Exportar / importar CSV**: baixe seus lançamentos ou importe de uma planilha
  (categorias faltantes são criadas automaticamente).
- **Assistente** (chat): responde "qual meu saldo?", "onde gastei mais?",
  "onde posso cortar?", "qual a tendência?", "e minhas metas?" analisando seus
  próprios dados — sem API externa, sem chave exposta, zero custo.

## A "IA" é baseada em regras (de propósito)

Como o app roda num site estático (GitHub Pages), qualquer chave de API de um
LLM colada no código ficaria **pública**. Para evitar isso e manter custo zero,
o assistente analisa seus dados **localmente** (ver `js/model.js` →
`buildInsights` e `answerQuestion`) e gera orientações a partir de regras
financeiras (saldo, taxa de poupança, maior gasto, estouro de orçamento, etc.).

Dá para evoluir para um LLM de verdade (ex.: Gemini) numa fase 2, usando uma
Cloud Function do Firebase para esconder a chave — isso exige o plano Blaze.

## Estrutura

```
.
├── index.html          # Interface (login + 5 telas)
├── styles.css          # Estilos
├── firebase-config.js  # Config do Firebase (placeholders = modo local)
├── firestore.rules     # Regras de segurança (dados privados por usuário)
└── js/
    ├── model.js        # Regras de negócio + motor de insights (a "IA")
    ├── store.js        # Persistência/auth (localStorage ↔ Firebase)
    └── app.js          # UI, gráfico e chat
```

## Rodar localmente

Abra o `index.html` no navegador. Sem Firebase configurado, ele usa o
`localStorage` e já entra direto no app (sem login). Precisa de internet para o
Chart.js (CDN).

## Configurar o Firebase (opcional, mas recomendado)

1. Crie um projeto novo em https://console.firebase.google.com (separado do
   projeto de avaliação, para não misturar dados).
2. **Build → Authentication → Sign-in method → Email/Password → Ativar.**
3. **Build → Firestore Database → Criar banco** (modo produção).
4. Em **Firestore → Rules**, cole o conteúdo de `firestore.rules` e publique.
5. **Configurações do projeto → Seus apps → Web (`</>`)** e copie o objeto de
   configuração para `firebase-config.js` (substituindo os `COLE_AQUI_...`).
6. Recarregue o app: agora aparece a tela de login e os dados vão para o
   Firestore, isolados por usuário.

As regras garantem que cada pessoa só lê e escreve o que está sob o próprio
`uid` (`users/{uid}/...`). Ninguém acessa os dados de outro usuário.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e suba estes arquivos.
2. **Settings → Pages**.
3. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
4. Selecione a branch `main` e a pasta `/ (root)`. Salve.
5. Aguarde ~1 min. A URL será `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

O `.nojekyll` garante que a pasta `js/` seja servida corretamente.

> Se usar Firebase, adicione o domínio do Pages
> (`SEU_USUARIO.github.io`) em **Authentication → Settings → Authorized
> domains** para o login funcionar na URL publicada.
