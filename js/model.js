// ============================================================================
// MODEL: regras de negócio puras (sem DOM, sem Firebase)
// ----------------------------------------------------------------------------
// Contém:
//   - categorias padrão e seus ícones
//   - utilitários de data, mês e formatação de moeda (BRL)
//   - agregações: totais do mês, gasto por categoria, saldo
//   - MOTOR DE INSIGHTS ("IA" baseada em regras): analisa os lançamentos e o
//     orçamento e devolve mensagens de orientação, sem chamar nenhuma API
//     externa (zero custo, nada de chave exposta).
//
// Tudo aqui é função pura e testável: recebe dados, devolve dados.
// ============================================================================

(function () {
  // --- Categorias padrão -----------------------------------------------------
  // O usuário pode adicionar as suas próprias (ver store/app); estas vêm de
  // fábrica para o app já ser útil no primeiro uso.
  const DEFAULT_CATEGORIES = [
    { id: 'alimentacao', name: 'Alimentação', icon: '🍽️', kind: 'expense' },
    { id: 'transporte',  name: 'Transporte',  icon: '🚗', kind: 'expense' },
    { id: 'moradia',     name: 'Moradia',     icon: '🏠', kind: 'expense' },
    { id: 'saude',       name: 'Saúde',       icon: '💊', kind: 'expense' },
    { id: 'educacao',    name: 'Educação',    icon: '📚', kind: 'expense' },
    { id: 'lazer',       name: 'Lazer',       icon: '🎉', kind: 'expense' },
    { id: 'compras',     name: 'Compras',     icon: '🛍️', kind: 'expense' },
    { id: 'contas',      name: 'Contas',      icon: '🧾', kind: 'expense' },
    { id: 'outros',      name: 'Outros',      icon: '📦', kind: 'expense' },
    { id: 'salario',     name: 'Salário',     icon: '💰', kind: 'income' },
    { id: 'renda-extra', name: 'Renda extra', icon: '✨', kind: 'income' },
  ];

  // --- Datas e mês -----------------------------------------------------------
  // Chave de mês no formato 'YYYY-MM' (ex.: '2026-10'), usada para agrupar.
  function monthKeyFor(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  function currentMonthKey() {
    return monthKeyFor(new Date());
  }

  // 'YYYY-MM' -> rótulo "Outubro de 2026"
  function monthLabel(key) {
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    const [y, m] = String(key).split('-').map(Number);
    if (!y || !m) return String(key);
    return meses[m - 1] + ' de ' + y;
  }

  // Data de hoje em 'YYYY-MM-DD' (para preencher o form).
  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // --- Moeda -----------------------------------------------------------------
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function formatBRL(value) {
    const n = Number(value) || 0;
    return brl.format(n);
  }

  // --- Agregações ------------------------------------------------------------
  // Filtra lançamentos de um mês ('YYYY-MM').
  function entriesOfMonth(entries, monthKey) {
    return (entries || []).filter((e) => monthKeyFor(e.date) === monthKey);
  }

  // Totais do mês: receitas, despesas e saldo (receitas - despesas).
  function monthlyTotals(entries, monthKey) {
    const list = entriesOfMonth(entries, monthKey);
    let income = 0;
    let expense = 0;
    for (const e of list) {
      const v = Number(e.amount) || 0;
      if (e.type === 'income') income += v;
      else expense += v;
    }
    return { income, expense, balance: income - expense, count: list.length };
  }

  // Soma de despesas por categoria no mês. Devolve
  // [{ categoryId, name, icon, total }] ordenado do maior para o menor.
  function expenseByCategory(entries, monthKey, categories) {
    const list = entriesOfMonth(entries, monthKey).filter((e) => e.type === 'expense');
    const byId = {};
    for (const e of list) {
      const id = e.categoryId || 'outros';
      byId[id] = (byId[id] || 0) + (Number(e.amount) || 0);
    }
    const catMap = {};
    (categories || []).forEach((c) => (catMap[c.id] = c));
    return Object.keys(byId)
      .map((id) => ({
        categoryId: id,
        name: (catMap[id] && catMap[id].name) || id,
        icon: (catMap[id] && catMap[id].icon) || '📦',
        total: byId[id],
      }))
      .sort((a, b) => b.total - a.total);
  }

  // Status de orçamento por categoria no mês. budgets = { categoryId: limite }.
  // Devolve [{ categoryId, name, icon, limit, spent, remaining, pct, over }].
  function budgetStatus(entries, monthKey, categories, budgets) {
    const spentByCat = {};
    expenseByCategory(entries, monthKey, categories).forEach((r) => {
      spentByCat[r.categoryId] = r.total;
    });
    const catMap = {};
    (categories || []).forEach((c) => (catMap[c.id] = c));

    return Object.keys(budgets || {})
      .filter((id) => Number(budgets[id]) > 0)
      .map((id) => {
        const limit = Number(budgets[id]) || 0;
        const spent = spentByCat[id] || 0;
        const remaining = limit - spent;
        const pct = limit > 0 ? (spent / limit) * 100 : 0;
        return {
          categoryId: id,
          name: (catMap[id] && catMap[id].name) || id,
          icon: (catMap[id] && catMap[id].icon) || '📦',
          limit,
          spent,
          remaining,
          pct,
          over: spent > limit,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }

  // ==========================================================================
  //  MOTOR DE INSIGHTS — a "IA" baseada em regras (opção A)
  // --------------------------------------------------------------------------
  //  Não chama nenhuma API externa. Recebe o estado financeiro do mês e devolve
  //  uma lista de mensagens { level, text } onde level ∈ 'good'|'warn'|'bad'|'info'.
  //  Usado tanto no dashboard (cartões de insight) quanto no chat (respostas).
  // ==========================================================================
  function buildInsights(entries, monthKey, categories, budgets) {
    const insights = [];
    const totals = monthlyTotals(entries, monthKey);
    const byCat = expenseByCategory(entries, monthKey, categories);
    const budgetRows = budgetStatus(entries, monthKey, categories, budgets);

    // 0) Sem dados ainda
    if (totals.count === 0) {
      insights.push({
        level: 'info',
        text: 'Você ainda não lançou nada em ' + monthLabel(monthKey) +
          '. Comece registrando suas receitas e despesas na aba Lançamentos.',
      });
      return insights;
    }

    // 1) Saldo do mês
    if (totals.balance > 0) {
      insights.push({
        level: 'good',
        text: 'Seu saldo em ' + monthLabel(monthKey) + ' está positivo: ' +
          formatBRL(totals.balance) + ' sobrando. Boa! Vale guardar parte disso.',
      });
    } else if (totals.balance < 0) {
      insights.push({
        level: 'bad',
        text: 'Atenção: você gastou ' + formatBRL(-totals.balance) +
          ' a mais do que recebeu em ' + monthLabel(monthKey) +
          '. Hora de revisar os gastos maiores.',
      });
    } else {
      insights.push({
        level: 'warn',
        text: 'Seu saldo em ' + monthLabel(monthKey) +
          ' está zerado: tudo que entrou, saiu. Sem margem para imprevistos.',
      });
    }

    // 2) Taxa de poupança (quanto da receita sobrou)
    if (totals.income > 0) {
      const savingRate = (totals.balance / totals.income) * 100;
      if (savingRate >= 20) {
        insights.push({
          level: 'good',
          text: 'Você está poupando ' + savingRate.toFixed(0) +
            '% da sua renda. Acima dos 20% recomendados — excelente disciplina.',
        });
      } else if (savingRate > 0) {
        insights.push({
          level: 'info',
          text: 'Você poupou ' + savingRate.toFixed(0) +
            '% da renda este mês. Uma meta saudável é chegar a 20%.',
        });
      }
    }

    // 3) Maior categoria de gasto
    if (byCat.length > 0 && totals.expense > 0) {
      const top = byCat[0];
      const share = (top.total / totals.expense) * 100;
      insights.push({
        level: share >= 40 ? 'warn' : 'info',
        text: 'Seu maior gasto foi ' + top.icon + ' ' + top.name + ': ' +
          formatBRL(top.total) + ' (' + share.toFixed(0) + '% das despesas).' +
          (share >= 40 ? ' É uma fatia alta — talvez dê para enxugar aqui.' : ''),
      });
    }

    // 4) Orçamentos estourados ou quase
    const over = budgetRows.filter((b) => b.over);
    const near = budgetRows.filter((b) => !b.over && b.pct >= 80);
    over.forEach((b) => {
      insights.push({
        level: 'bad',
        text: 'Orçamento estourado em ' + b.icon + ' ' + b.name + ': gastou ' +
          formatBRL(b.spent) + ' de ' + formatBRL(b.limit) + ' (' +
          (b.pct).toFixed(0) + '%).',
      });
    });
    near.forEach((b) => {
      insights.push({
        level: 'warn',
        text: 'Perto do limite em ' + b.icon + ' ' + b.name + ': ' +
          (b.pct).toFixed(0) + '% do orçamento usado (' +
          formatBRL(b.spent) + ' de ' + formatBRL(b.limit) + ').',
      });
    });

    // 5) Reforço positivo quando tudo dentro do orçamento
    if (budgetRows.length > 0 && over.length === 0 && near.length === 0) {
      insights.push({
        level: 'good',
        text: 'Todas as categorias com orçamento estão dentro do limite. Mandou bem!',
      });
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  //  CHAT POR REGRAS — interpreta a pergunta do usuário e responde usando as
  //  mesmas agregações. Casamento por palavras-chave (intents). Devolve string.
  // --------------------------------------------------------------------------
  function answerQuestion(question, entries, monthKey, categories, budgets, goals) {
    const q = (question || '').toLowerCase().trim();
    const totals = monthlyTotals(entries, monthKey);
    const byCat = expenseByCategory(entries, monthKey, categories);
    const budgetRows = budgetStatus(entries, monthKey, categories, budgets);
    const label = monthLabel(monthKey);

    if (!q) {
      return 'Pode perguntar coisas como: "qual meu saldo?", "onde gastei mais?", ' +
        '"como está meu orçamento?", "e minhas metas?" ou "qual a tendência?".';
    }

    // saldo
    if (/(saldo|sobr|quanto.*(sobr|rest))/.test(q)) {
      if (totals.count === 0) return 'Ainda não há lançamentos em ' + label + '.';
      const sign = totals.balance >= 0 ? 'positivo' : 'negativo';
      return 'Em ' + label + ', seu saldo está ' + sign + ': ' +
        formatBRL(totals.balance) + '. Receitas ' + formatBRL(totals.income) +
        ' e despesas ' + formatBRL(totals.expense) + '.';
    }

    // onde gastei mais / maior gasto
    if (/(gast.*(mais|maior)|maior.*gast|onde.*gast)/.test(q)) {
      if (byCat.length === 0) return 'Não há despesas registradas em ' + label + '.';
      const top = byCat[0];
      const share = totals.expense > 0 ? (top.total / totals.expense) * 100 : 0;
      const lista = byCat.slice(0, 3)
        .map((c) => '• ' + c.icon + ' ' + c.name + ': ' + formatBRL(c.total))
        .join('\n');
      return 'Seu maior gasto em ' + label + ' foi ' + top.icon + ' ' + top.name +
        ' (' + share.toFixed(0) + '% das despesas).\nTop 3:\n' + lista;
    }

    // onde posso cortar / economizar / dica
    if (/(cort|economiz|poupar|dica|reduz|diminu)/.test(q)) {
      if (byCat.length === 0) return 'Registre alguns gastos primeiro para eu sugerir onde cortar.';
      const over = budgetRows.filter((b) => b.over);
      if (over.length > 0) {
        const b = over[0];
        return 'Comece pelo orçamento estourado: ' + b.icon + ' ' + b.name +
          ' passou ' + formatBRL(b.spent - b.limit) + ' do limite. ' +
          'Cortar aqui tem o maior impacto imediato.';
      }
      const top = byCat[0];
      return 'A categoria com mais espaço para cortar é ' + top.icon + ' ' + top.name +
        ' (' + formatBRL(top.total) + ' no mês). Reduzir 10% já economizaria ' +
        formatBRL(top.total * 0.1) + '.';
    }

    // orçamento
    if (/(orçament|orcament|limite|budget)/.test(q)) {
      if (budgetRows.length === 0) {
        return 'Você ainda não definiu orçamentos. Vá em Orçamento e defina um teto ' +
          'por categoria para eu acompanhar.';
      }
      const linhas = budgetRows.map((b) =>
        '• ' + b.icon + ' ' + b.name + ': ' + formatBRL(b.spent) + ' de ' +
        formatBRL(b.limit) + ' (' + b.pct.toFixed(0) + '%)' + (b.over ? ' ⚠️ estourou' : '')
      ).join('\n');
      return 'Situação dos orçamentos em ' + label + ':\n' + linhas;
    }

    // receita / ganho
    if (/(receit|ganh|renda|entrou|recebi)/.test(q)) {
      return 'Em ' + label + ', suas receitas somam ' + formatBRL(totals.income) + '.';
    }

    // despesa / gasto total
    if (/(despesa|gastei|gasto total|total.*gast)/.test(q)) {
      return 'Em ' + label + ', suas despesas somam ' + formatBRL(totals.expense) +
        ' em ' + totals.count + ' lançamento(s).';
    }

    // tendência / histórico / evolução / comparar com mês anterior
    if (/(tend[êe]ncia|hist[óo]rico|evolu|[úu]ltimos meses|m[êe]s passado|m[êe]s anterior|compar)/.test(q)) {
      const tr = trendInsights(entries, monthKey, 6);
      const cmp = monthComparison(entries, monthKey, categories);
      const arrow = cmp.deltaExpense > 0 ? 'subiram' : cmp.deltaExpense < 0 ? 'caíram' : 'ficaram iguais';
      const head = 'Vs. ' + monthLabel(cmp.previousKey) + ', suas despesas ' + arrow + ' ' +
        formatBRL(Math.abs(cmp.deltaExpense)) + ' (' +
        (cmp.deltaPct >= 0 ? '+' : '') + cmp.deltaPct.toFixed(0) + '%).';
      return head + '\n' + tr.map((i) => '• ' + i.text).join('\n');
    }

    // metas de economia
    if (/(meta|metas|objetivo|guard|reserva|poupança|poupanca)/.test(q)) {
      const gs = goals || [];
      if (gs.length === 0) {
        return 'Você ainda não tem metas. Vá em Metas e crie uma (ex.: "Reserva ' +
          'de emergência: R$ 5.000") para eu acompanhar seu progresso.';
      }
      const linhas = gs.map((g) => {
        const p = goalProgress(g);
        return '• ' + g.name + ': ' + formatBRL(p.saved) + ' de ' + formatBRL(p.target) +
          ' (' + p.pct.toFixed(0) + '%)' + (p.done ? ' 🎉' : ' — faltam ' + formatBRL(p.remaining));
      }).join('\n');
      return 'Suas metas:\n' + linhas;
    }

    // resumo / como estou / situação
    if (/(resumo|como.*(estou|tô|to|vou|van)|situaç|situac|geral|panorama)/.test(q)) {
      const ins = buildInsights(entries, monthKey, categories, budgets);
      return 'Resumo de ' + label + ':\n' + ins.map((i) => '• ' + i.text).join('\n');
    }

    // fallback: devolve o resumo de insights
    const ins = buildInsights(entries, monthKey, categories, budgets);
    return 'Não entendi exatamente, mas aqui vai um panorama de ' + label + ':\n' +
      ins.map((i) => '• ' + i.text).join('\n') +
      '\n\nTente: "qual meu saldo?", "onde gastei mais?", "onde posso cortar?".';
  }

  // ==========================================================================
  //  HISTÓRICO / TENDÊNCIA (Relatórios)
  // ==========================================================================
  // Mês anterior a uma chave 'YYYY-MM'.
  function previousMonthKey(key) {
    const [y, m] = String(key).split('-').map(Number);
    const d = new Date(y, (m - 1) - 1, 1); // mês anterior
    return monthKeyFor(d);
  }

  // Série dos últimos N meses terminando em endKey (inclusive). Devolve
  // [{ key, label, income, expense, balance }] do mais antigo ao mais novo.
  function monthlySeries(entries, endKey, n) {
    const count = n || 6;
    const [y, m] = String(endKey).split('-').map(Number);
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(y, (m - 1) - i, 1);
      const key = monthKeyFor(d);
      const t = monthlyTotals(entries, key);
      out.push({ key, label: shortMonthLabel(key), income: t.income, expense: t.expense, balance: t.balance });
    }
    return out;
  }

  // 'YYYY-MM' -> rótulo curto "out/26" (para eixos de gráfico).
  function shortMonthLabel(key) {
    const abbr = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
      'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const [y, m] = String(key).split('-').map(Number);
    if (!y || !m) return String(key);
    return abbr[m - 1] + '/' + String(y).slice(-2);
  }

  // Comparativo do mês atual vs. o anterior, no total e por categoria.
  // Devolve { current, previous, deltaExpense, deltaPct, categories:[...] }
  // onde cada categoria traz { name, icon, now, before, delta, pct }.
  function monthComparison(entries, monthKey, categories) {
    const prevKey = previousMonthKey(monthKey);
    const cur = monthlyTotals(entries, monthKey);
    const prev = monthlyTotals(entries, prevKey);

    const curByCat = {};
    expenseByCategory(entries, monthKey, categories).forEach((r) => (curByCat[r.categoryId] = r));
    const prevByCat = {};
    expenseByCategory(entries, prevKey, categories).forEach((r) => (prevByCat[r.categoryId] = r));

    const ids = new Set([...Object.keys(curByCat), ...Object.keys(prevByCat)]);
    const cats = [];
    ids.forEach((id) => {
      const now = curByCat[id] ? curByCat[id].total : 0;
      const before = prevByCat[id] ? prevByCat[id].total : 0;
      const ref = curByCat[id] || prevByCat[id];
      const delta = now - before;
      const pct = before > 0 ? (delta / before) * 100 : (now > 0 ? 100 : 0);
      cats.push({ categoryId: id, name: ref.name, icon: ref.icon, now, before, delta, pct });
    });
    cats.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const deltaExpense = cur.expense - prev.expense;
    const deltaPct = prev.expense > 0 ? (deltaExpense / prev.expense) * 100 : (cur.expense > 0 ? 100 : 0);

    return {
      currentKey: monthKey, previousKey: prevKey,
      current: cur, previous: prev,
      deltaExpense, deltaPct, categories: cats,
    };
  }

  // Insights de tendência olhando a série dos últimos meses (texto).
  function trendInsights(entries, endKey, n) {
    const series = monthlySeries(entries, endKey, n || 4);
    const withData = series.filter((s) => s.income > 0 || s.expense > 0);
    const out = [];
    if (withData.length < 2) {
      out.push({ level: 'info', text: 'Ainda não há meses suficientes para analisar tendência. ' +
        'Siga lançando que em alguns meses eu mostro a evolução.' });
      return out;
    }
    // tendência de despesa: últimos 3 pontos com dados
    const tail = withData.slice(-3);
    let rising = true, falling = true;
    for (let i = 1; i < tail.length; i++) {
      if (!(tail[i].expense > tail[i - 1].expense)) rising = false;
      if (!(tail[i].expense < tail[i - 1].expense)) falling = false;
    }
    if (tail.length >= 3 && rising) {
      out.push({ level: 'warn', text: 'Seus gastos vêm subindo há ' + tail.length +
        ' meses seguidos. Vale olhar o que está puxando esse aumento.' });
    } else if (tail.length >= 3 && falling) {
      out.push({ level: 'good', text: 'Seus gastos vêm caindo há ' + tail.length +
        ' meses seguidos. Ótima trajetória!' });
    }
    // média de saldo
    const avgBalance = withData.reduce((s, m) => s + m.balance, 0) / withData.length;
    out.push({
      level: avgBalance >= 0 ? 'good' : 'bad',
      text: 'Saldo médio dos últimos ' + withData.length + ' meses: ' + formatBRL(avgBalance) +
        (avgBalance >= 0 ? ' — você tende a fechar no azul.' : ' — você tende a fechar no vermelho.'),
    });
    // mês mais caro
    const worst = withData.slice().sort((a, b) => b.expense - a.expense)[0];
    out.push({ level: 'info', text: 'Mês de maior gasto no período: ' + monthLabel(worst.key) +
      ' (' + formatBRL(worst.expense) + ').' });
    return out;
  }

  // ==========================================================================
  //  METAS DE ECONOMIA
  // ==========================================================================
  // meta = { id, name, target, deadline?, contributions:[{date, amount}] }
  function goalSaved(goal) {
    return (goal && goal.contributions || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  }
  function goalProgress(goal) {
    const saved = goalSaved(goal);
    const target = Number(goal && goal.target) || 0;
    const pct = target > 0 ? Math.min((saved / target) * 100, 100) : 0;
    return { saved, target, remaining: Math.max(target - saved, 0), pct, done: target > 0 && saved >= target };
  }

  // ==========================================================================
  //  CSV (exportar / importar lançamentos)
  // ==========================================================================
  // Escapa um campo para CSV (aspas duplas, vírgula, quebra de linha).
  function csvField(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Gera CSV dos lançamentos. Cabeçalho fixo: data,tipo,categoria,valor,descricao.
  // 'tipo' em português (receita/despesa); 'categoria' é o NOME legível.
  function entriesToCSV(entries, categories) {
    const catMap = {};
    (categories || []).forEach((c) => (catMap[c.id] = c));
    const header = ['data', 'tipo', 'categoria', 'valor', 'descricao'];
    const rows = (entries || [])
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((e) => {
        const cat = catMap[e.categoryId];
        return [
          e.date,
          e.type === 'income' ? 'receita' : 'despesa',
          cat ? cat.name : (e.categoryId || ''),
          String(Number(e.amount) || 0).replace('.', ','), // decimal com vírgula (pt-BR)
          e.note || '',
        ].map(csvField).join(',');
      });
    return [header.join(','), ...rows].join('\r\n');
  }

  // Faz o parse de uma linha CSV respeitando aspas. Devolve array de campos.
  function parseCSVLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // Interpreta o CSV e devolve { entries:[...], newCategories:[...], errors:[...] }.
  // Cria descritores de categoria (por NOME) para nomes ainda inexistentes; o
  // chamador decide persisti-los. 'valor' aceita vírgula ou ponto decimal.
  function csvToEntries(text, categories) {
    const result = { entries: [], newCategories: [], errors: [] };
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return result;

    // Mapa de NOME normalizado -> categoria existente.
    const byName = {};
    (categories || []).forEach((c) => (byName[normName(c.name)] = c));
    const pendingNames = {}; // nome normalizado -> descritor novo (evita duplicar)

    // Detecta e pula o cabeçalho se a 1ª linha parecer um header.
    let start = 0;
    const first = parseCSVLine(lines[0]).map((s) => s.trim().toLowerCase());
    if (first.includes('data') && first.includes('valor')) start = 1;

    for (let i = start; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]).map((s) => s.trim());
      if (cols.length < 4) { result.errors.push('Linha ' + (i + 1) + ': colunas insuficientes.'); continue; }
      const [dataRaw, tipoRaw, catRaw, valorRaw, descRaw] = cols;

      const date = normDate(dataRaw);
      if (!date) { result.errors.push('Linha ' + (i + 1) + ': data inválida ("' + dataRaw + '").'); continue; }

      const t = (tipoRaw || '').toLowerCase();
      const type = /receit|income|entrada/.test(t) ? 'income' : 'expense';

      const amount = parseFloat(String(valorRaw).replace(/\./g, '').replace(',', '.')) ||
                     parseFloat(valorRaw) || 0;
      if (!(amount > 0)) { result.errors.push('Linha ' + (i + 1) + ': valor inválido ("' + valorRaw + '").'); continue; }

      // Resolve categoria por nome; cria descritor novo se não existir.
      const nm = normName(catRaw || 'Outros');
      let cat = byName[nm] || pendingNames[nm];
      if (!cat) {
        cat = { id: slugModel(catRaw) || ('cat-' + Date.now().toString(36) + i),
                name: catRaw || 'Outros', icon: type === 'income' ? '✨' : '📦', kind: type };
        pendingNames[nm] = cat;
        result.newCategories.push(cat);
      }

      result.entries.push({ type, amount, date, categoryId: cat.id, note: descRaw || '' });
    }
    return result;
  }

  function normName(s) {
    return String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function slugModel(s) {
    return normName(s).replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  }
  // Normaliza data para 'YYYY-MM-DD'. Aceita 'YYYY-MM-DD' e 'DD/MM/YYYY'.
  function normDate(s) {
    const v = String(s || '').trim();
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    return null;
  }

  // --- Exporta tudo no namespace global Model --------------------------------
  window.Model = {
    DEFAULT_CATEGORIES,
    monthKeyFor,
    currentMonthKey,
    monthLabel,
    shortMonthLabel,
    previousMonthKey,
    todayISO,
    formatBRL,
    entriesOfMonth,
    monthlyTotals,
    expenseByCategory,
    budgetStatus,
    buildInsights,
    answerQuestion,
    monthlySeries,
    monthComparison,
    trendInsights,
    goalSaved,
    goalProgress,
    entriesToCSV,
    csvToEntries,
  };
})();
