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
  function answerQuestion(question, entries, monthKey, categories, budgets) {
    const q = (question || '').toLowerCase().trim();
    const totals = monthlyTotals(entries, monthKey);
    const byCat = expenseByCategory(entries, monthKey, categories);
    const budgetRows = budgetStatus(entries, monthKey, categories, budgets);
    const label = monthLabel(monthKey);

    if (!q) {
      return 'Pode perguntar coisas como: "qual meu saldo?", "onde gastei mais?", ' +
        '"como está meu orçamento?" ou "onde posso cortar?".';
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

  // --- Exporta tudo no namespace global Model --------------------------------
  window.Model = {
    DEFAULT_CATEGORIES,
    monthKeyFor,
    currentMonthKey,
    monthLabel,
    todayISO,
    formatBRL,
    entriesOfMonth,
    monthlyTotals,
    expenseByCategory,
    budgetStatus,
    buildInsights,
    answerQuestion,
  };
})();
