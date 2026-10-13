// ============================================================================
// APP: camada de interface (DOM) do assistente financeiro
// ----------------------------------------------------------------------------
// Orquestra Store (dados/auth) + Model (regras/insights) e renderiza as telas:
//   Dashboard | Lançamentos | Orçamento | Assistente (chat) | Categorias
//
// Estado em memória (recarregado do Store a cada login/alteração):
//   state.entries   -> lançamentos do usuário
//   state.settings  -> { categories, budgets }
//   state.monthKey  -> mês selecionado ('YYYY-MM')
// ============================================================================

(function () {
  const M = window.Model;
  const Store = window.Store;

  const state = {
    entries: [],
    settings: { categories: [], budgets: {}, goals: [] },
    monthKey: M.currentMonthKey(),
    user: null,
  };

  let chart = null;         // gráfico de categorias (dashboard)
  let historyChart = null;  // gráfico de histórico (relatórios)

  // --- Helpers de DOM --------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  // ==========================================================================
  //  AUTENTICAÇÃO
  // ==========================================================================
  let authMode = 'login'; // 'login' | 'signup'

  function setupAuthUI() {
    const form = $('#auth-form');
    const toggleLink = $('#auth-toggle-link');
    const toggleText = $('#auth-toggle-text');
    const submitBtn = $('#auth-submit');
    const errorBox = $('#auth-error');

    function render() {
      if (authMode === 'login') {
        submitBtn.textContent = 'Entrar';
        toggleText.textContent = 'Não tem conta?';
        toggleLink.textContent = 'Criar conta';
        $('#auth-password').autocomplete = 'current-password';
      } else {
        submitBtn.textContent = 'Criar conta';
        toggleText.textContent = 'Já tem conta?';
        toggleLink.textContent = 'Entrar';
        $('#auth-password').autocomplete = 'new-password';
      }
      hide(errorBox);
    }

    toggleLink.addEventListener('click', (e) => {
      e.preventDefault();
      authMode = authMode === 'login' ? 'signup' : 'login';
      render();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hide(errorBox);
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      submitBtn.disabled = true;
      try {
        if (authMode === 'login') await Store.login(email, password);
        else await Store.signup(email, password);
        // onAuth cuida da transição de tela.
      } catch (err) {
        errorBox.textContent = friendlyAuthError(err);
        show(errorBox);
      } finally {
        submitBtn.disabled = false;
      }
    });

    render();
  }

  function friendlyAuthError(err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/user-not-found': 'Usuário não encontrado. Crie uma conta.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/email-already-in-use': 'Este e-mail já tem conta. Faça login.',
      'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
      'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
      'app/not-allowed': 'Este e-mail não tem permissão de acesso. ' +
        'Fale com o responsável para ser liberado.',
    };
    return map[code] || (err && err.message) || 'Não foi possível autenticar.';
  }

  // ==========================================================================
  //  NAVEGAÇÃO ENTRE VIEWS
  // ==========================================================================
  function setupNav() {
    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        $$('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== view));
        if (view === 'dashboard') renderDashboard();
        if (view === 'reports') renderReports();
        if (view === 'goals') renderGoals();
      });
    });

    const monthSelect = $('#month-select');
    monthSelect.value = state.monthKey;
    monthSelect.addEventListener('change', () => {
      state.monthKey = monthSelect.value || M.currentMonthKey();
      renderAll();
    });
  }

  // ==========================================================================
  //  CARGA DE DADOS
  // ==========================================================================
  async function loadData() {
    state.settings = await Store.getSettings();
    state.entries = await Store.listEntries();
  }

  function renderAll() {
    renderDashboard();
    renderEntries();
    renderBudget();
    renderReports();
    renderGoals();
    renderCategories();
    fillCategoryDropdown();
  }

  // ==========================================================================
  //  DASHBOARD
  // ==========================================================================
  function renderDashboard() {
    const mk = state.monthKey;
    $('#dash-month').textContent = M.monthLabel(mk);
    const totals = M.monthlyTotals(state.entries, mk);
    $('#stat-income').textContent = M.formatBRL(totals.income);
    $('#stat-expense').textContent = M.formatBRL(totals.expense);
    const balanceEl = $('#stat-balance');
    balanceEl.textContent = M.formatBRL(totals.balance);
    balanceEl.classList.toggle('income', totals.balance > 0);
    balanceEl.classList.toggle('expense', totals.balance < 0);

    renderCategoryChart();
    renderInsights();
  }

  function renderCategoryChart() {
    const rows = M.expenseByCategory(state.entries, state.monthKey, state.settings.categories);
    const canvas = $('#chart-categories');
    const emptyMsg = $('#chart-empty');

    if (rows.length === 0) {
      show(emptyMsg);
      hide(canvas);
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    hide(emptyMsg);
    show(canvas);

    const labels = rows.map((r) => r.icon + ' ' + r.name);
    const data = rows.map((r) => r.total);
    const palette = ['#6366f1', '#22c55e', '#ef4444', '#f59e0b', '#38bdf8',
      '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#64748b'];
    const colors = rows.map((_, i) => palette[i % palette.length]);

    if (typeof Chart === 'undefined') { // CDN bloqueado: degrada sem quebrar
      show(emptyMsg);
      emptyMsg.textContent = 'Gráfico indisponível (Chart.js não carregou).';
      hide(canvas);
      return;
    }

    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#e2e8f0', boxWidth: 14 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ' ' + M.formatBRL(ctx.parsed),
            },
          },
        },
      },
    });
  }

  function renderInsights() {
    const list = $('#insights-list');
    const insights = M.buildInsights(
      state.entries, state.monthKey, state.settings.categories, state.settings.budgets
    );
    const icons = { good: '✅', warn: '⚠️', bad: '🚨', info: 'ℹ️' };
    list.innerHTML = insights.map((i) =>
      '<div class="insight ' + i.level + '">' +
      '<span class="ico">' + (icons[i.level] || 'ℹ️') + '</span>' +
      '<span>' + escapeHTML(i.text) + '</span></div>'
    ).join('');
  }

  // ==========================================================================
  //  LANÇAMENTOS
  // ==========================================================================
  function setupEntries() {
    const form = $('#entry-form');
    const openBtn = $('#open-entry-form');
    const cancelBtn = $('#cancel-entry');

    openBtn.addEventListener('click', () => openEntryForm());
    cancelBtn.addEventListener('click', () => hide(form));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entry = {
        id: $('#entry-id').value || undefined,
        type: $('#entry-type').value,
        amount: parseFloat($('#entry-amount').value) || 0,
        date: $('#entry-date').value,
        categoryId: $('#entry-category').value,
        note: $('#entry-note').value.trim(),
      };
      if (entry.amount <= 0 || !entry.date) return;
      await Store.saveEntry(entry);
      state.entries = await Store.listEntries();
      hide(form);
      renderAll();
    });
  }

  function openEntryForm(entry) {
    const form = $('#entry-form');
    $('#entry-id').value = entry ? entry.id : '';
    $('#entry-type').value = entry ? entry.type : 'expense';
    $('#entry-amount').value = entry ? entry.amount : '';
    $('#entry-date').value = entry ? entry.date : M.todayISO();
    $('#entry-note').value = entry ? (entry.note || '') : '';
    fillCategoryDropdown(entry ? entry.categoryId : null);
    show(form);
    $('#entry-amount').focus();
  }

  function fillCategoryDropdown(selectedId) {
    const sel = $('#entry-category');
    const type = $('#entry-type').value;
    renderCategoryOptions(sel, type, selectedId);
    // ao trocar o tipo, recarrega as categorias compatíveis
    $('#entry-type').onchange = () => renderCategoryOptions(sel, $('#entry-type').value, null);
  }

  function renderCategoryOptions(sel, type, selectedId) {
    const cats = state.settings.categories.filter((c) => c.kind === type);
    sel.innerHTML = cats.map((c) =>
      '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' +
      c.icon + ' ' + escapeHTML(c.name) + '</option>'
    ).join('');
  }

  function renderEntries() {
    const body = $('#entries-body');
    const empty = $('#entries-empty');
    const rows = M.entriesOfMonth(state.entries, state.monthKey)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    if (rows.length === 0) {
      body.innerHTML = '';
      show(empty);
      return;
    }
    hide(empty);

    const catMap = {};
    state.settings.categories.forEach((c) => (catMap[c.id] = c));

    body.innerHTML = rows.map((e) => {
      const cat = catMap[e.categoryId] || { icon: '📦', name: e.categoryId || '—' };
      const sign = e.type === 'income' ? '+' : '−';
      const cls = e.type === 'income' ? 'amount-income' : 'amount-expense';
      return '<tr>' +
        '<td>' + formatDate(e.date) + '</td>' +
        '<td><span class="cat-tag">' + cat.icon + ' ' + escapeHTML(cat.name) + '</span></td>' +
        '<td>' + escapeHTML(e.note || '') + '</td>' +
        '<td class="right ' + cls + '">' + sign + ' ' + M.formatBRL(e.amount) + '</td>' +
        '<td class="right">' +
          '<button class="btn-icon" data-edit="' + e.id + '" title="Editar">✏️</button>' +
          '<button class="btn-icon btn-danger" data-del="' + e.id + '" title="Excluir">🗑️</button>' +
        '</td></tr>';
    }).join('');

    $$('[data-edit]', body).forEach((b) =>
      b.addEventListener('click', () => {
        const entry = state.entries.find((x) => x.id === b.dataset.edit);
        if (entry) openEntryForm(entry);
      })
    );
    $$('[data-del]', body).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Excluir este lançamento?')) return;
        await Store.removeEntry(b.dataset.del);
        state.entries = await Store.listEntries();
        renderAll();
      })
    );
  }

  // ==========================================================================
  //  ORÇAMENTO
  // ==========================================================================
  function renderBudget() {
    const container = $('#budget-list');
    const expenseCats = state.settings.categories.filter((c) => c.kind === 'expense');
    const spentByCat = {};
    M.expenseByCategory(state.entries, state.monthKey, state.settings.categories)
      .forEach((r) => (spentByCat[r.categoryId] = r.total));

    container.innerHTML = expenseCats.map((c) => {
      const limit = Number(state.settings.budgets[c.id]) || 0;
      const spent = spentByCat[c.id] || 0;
      const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
      const over = limit > 0 && spent > limit;
      const near = limit > 0 && !over && (spent / limit) >= 0.8;
      const barCls = over ? 'over' : near ? 'warn' : '';
      const meta = limit > 0
        ? M.formatBRL(spent) + ' de ' + M.formatBRL(limit) +
          (over ? ' — estourou ' + M.formatBRL(spent - limit)
                : ' — resta ' + M.formatBRL(limit - spent))
        : 'Sem orçamento definido';
      return '<div class="budget-row">' +
        '<div class="budget-cat">' + c.icon + ' ' + escapeHTML(c.name) + '</div>' +
        '<div><input type="number" min="0" step="10" data-budget="' + c.id + '" ' +
          'value="' + (limit || '') + '" placeholder="0,00" /></div>' +
        '<div>' +
          '<div class="budget-bar ' + barCls + '"><span style="width:' + pct + '%"></span></div>' +
          '<div class="budget-meta">' + meta + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('[data-budget]', container).forEach((input) =>
      input.addEventListener('change', async () => {
        const id = input.dataset.budget;
        const val = parseFloat(input.value) || 0;
        if (val > 0) state.settings.budgets[id] = val;
        else delete state.settings.budgets[id];
        await Store.saveSettings(state.settings);
        renderBudget();
        renderDashboard();
      })
    );
  }

  // ==========================================================================
  //  RELATÓRIOS (histórico, comparativo, tendência)
  // ==========================================================================
  function renderReports() {
    renderHistoryChart();
    renderComparison();
    renderTrend();
  }

  function renderHistoryChart() {
    const series = M.monthlySeries(state.entries, state.monthKey, 6);
    const hasData = series.some((s) => s.income > 0 || s.expense > 0);
    const canvas = $('#chart-history');
    const empty = $('#history-empty');

    if (!hasData || typeof Chart === 'undefined') {
      show(empty);
      hide(canvas);
      if (!hasData) empty.textContent = 'Sem dados suficientes ainda.';
      else empty.textContent = 'Gráfico indisponível (Chart.js não carregou).';
      if (historyChart) { historyChart.destroy(); historyChart = null; }
      return;
    }
    hide(empty);
    show(canvas);

    if (historyChart) historyChart.destroy();
    historyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: series.map((s) => s.label),
        datasets: [
          { label: 'Receitas', data: series.map((s) => s.income), backgroundColor: '#22c55e' },
          { label: 'Despesas', data: series.map((s) => s.expense), backgroundColor: '#ef4444' },
          { label: 'Saldo', type: 'line', data: series.map((s) => s.balance),
            borderColor: '#6366f1', backgroundColor: '#6366f1', tension: 0.3, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#273449' } },
          y: { ticks: { color: '#94a3b8', callback: (v) => 'R$ ' + v }, grid: { color: '#273449' } },
        },
        plugins: {
          legend: { labels: { color: '#e2e8f0' } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + M.formatBRL(ctx.parsed.y) } },
        },
      },
    });
  }

  function renderComparison() {
    const cmp = M.monthComparison(state.entries, state.monthKey, state.settings.categories);
    const head = $('#comparison-head');
    const body = $('#comparison-body');
    const empty = $('#comparison-empty');

    const arrow = cmp.deltaExpense > 0 ? '🔺' : cmp.deltaExpense < 0 ? '🔻' : '▪️';
    const cls = cmp.deltaExpense > 0 ? 'amount-expense' : cmp.deltaExpense < 0 ? 'amount-income' : '';
    head.innerHTML =
      'Despesas: ' + M.formatBRL(cmp.previous.expense) + ' → ' + M.formatBRL(cmp.current.expense) +
      ' <span class="' + cls + '">' + arrow + ' ' + M.formatBRL(Math.abs(cmp.deltaExpense)) +
      ' (' + (cmp.deltaPct >= 0 ? '+' : '') + cmp.deltaPct.toFixed(0) + '%)</span>' +
      '<div class="muted">' + M.monthLabel(cmp.previousKey) + ' vs. ' + M.monthLabel(cmp.currentKey) + '</div>';

    if (cmp.categories.length === 0) {
      body.innerHTML = '';
      show(empty);
      return;
    }
    hide(empty);
    body.innerHTML = cmp.categories.map((c) => {
      const dcls = c.delta > 0 ? 'amount-expense' : c.delta < 0 ? 'amount-income' : 'muted';
      const sign = c.delta > 0 ? '+' : '';
      return '<tr>' +
        '<td>' + c.icon + ' ' + escapeHTML(c.name) + '</td>' +
        '<td class="right">' + M.formatBRL(c.before) + '</td>' +
        '<td class="right">' + M.formatBRL(c.now) + '</td>' +
        '<td class="right ' + dcls + '">' + sign + M.formatBRL(c.delta) +
          (c.before > 0 ? ' (' + sign + c.pct.toFixed(0) + '%)' : '') + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderTrend() {
    const list = $('#trend-list');
    const items = M.trendInsights(state.entries, state.monthKey, 6);
    const icons = { good: '✅', warn: '⚠️', bad: '🚨', info: 'ℹ️' };
    list.innerHTML = items.map((i) =>
      '<div class="insight ' + i.level + '">' +
      '<span class="ico">' + (icons[i.level] || 'ℹ️') + '</span>' +
      '<span>' + escapeHTML(i.text) + '</span></div>'
    ).join('');
  }

  // ==========================================================================
  //  METAS DE ECONOMIA
  // ==========================================================================
  function setupGoals() {
    const form = $('#goal-form');
    $('#open-goal-form').addEventListener('click', () => openGoalForm());
    $('#cancel-goal').addEventListener('click', () => hide(form));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#goal-id').value;
      const name = $('#goal-name').value.trim();
      const target = parseFloat($('#goal-target').value) || 0;
      const deadline = $('#goal-deadline').value || '';
      if (!name || target <= 0) return;

      if (id) {
        const g = state.settings.goals.find((x) => x.id === id);
        if (g) { g.name = name; g.target = target; g.deadline = deadline; }
      } else {
        state.settings.goals.push({
          id: 'g-' + Date.now().toString(36),
          name, target, deadline, contributions: [],
        });
      }
      await Store.saveSettings(state.settings);
      hide(form);
      renderGoals();
    });
  }

  function openGoalForm(goal) {
    const form = $('#goal-form');
    $('#goal-id').value = goal ? goal.id : '';
    $('#goal-name').value = goal ? goal.name : '';
    $('#goal-target').value = goal ? goal.target : '';
    $('#goal-deadline').value = goal ? (goal.deadline || '') : '';
    show(form);
    $('#goal-name').focus();
  }

  function renderGoals() {
    const container = $('#goals-list');
    const empty = $('#goals-empty');
    const goals = state.settings.goals || [];

    if (goals.length === 0) {
      container.innerHTML = '';
      show(empty);
      return;
    }
    hide(empty);

    container.innerHTML = goals.map((g) => {
      const p = M.goalProgress(g);
      const barCls = p.done ? 'done' : '';
      const deadline = g.deadline ? '<span class="muted">até ' + formatDate(g.deadline) + '</span>' : '';
      return '<div class="card goal-card">' +
        '<div class="goal-top">' +
          '<div><strong>' + escapeHTML(g.name) + '</strong> ' + deadline + '</div>' +
          '<div class="goal-actions">' +
            '<button class="btn-icon" data-editgoal="' + g.id + '" title="Editar">✏️</button>' +
            '<button class="btn-icon btn-danger" data-delgoal="' + g.id + '" title="Excluir">🗑️</button>' +
          '</div>' +
        '</div>' +
        '<div class="budget-bar ' + barCls + '"><span style="width:' + p.pct + '%"></span></div>' +
        '<div class="goal-meta">' +
          M.formatBRL(p.saved) + ' de ' + M.formatBRL(p.target) +
          ' (' + p.pct.toFixed(0) + '%)' +
          (p.done ? ' — 🎉 meta atingida!' : ' — faltam ' + M.formatBRL(p.remaining)) +
        '</div>' +
        '<div class="goal-add">' +
          '<input type="number" step="0.01" min="0" placeholder="Valor do aporte" data-amount="' + g.id + '" />' +
          '<button class="btn btn-primary btn-sm" data-contribute="' + g.id + '">+ Guardar</button>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('[data-editgoal]', container).forEach((b) =>
      b.addEventListener('click', () => {
        const g = goals.find((x) => x.id === b.dataset.editgoal);
        if (g) openGoalForm(g);
      })
    );
    $$('[data-delgoal]', container).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Excluir esta meta e seus aportes?')) return;
        state.settings.goals = state.settings.goals.filter((x) => x.id !== b.dataset.delgoal);
        await Store.saveSettings(state.settings);
        renderGoals();
      })
    );
    $$('[data-contribute]', container).forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.contribute;
        const input = container.querySelector('[data-amount="' + id + '"]');
        const amount = parseFloat(input.value) || 0;
        if (amount <= 0) { input.focus(); return; }
        const g = state.settings.goals.find((x) => x.id === id);
        if (!g) return;
        if (!Array.isArray(g.contributions)) g.contributions = [];
        g.contributions.push({ date: M.todayISO(), amount });
        await Store.saveSettings(state.settings);
        renderGoals();
      })
    );
  }

  // ==========================================================================
  //  CSV (exportar / importar)
  // ==========================================================================
  function setupCSV() {
    $('#export-csv').addEventListener('click', exportCSV);
    $('#import-csv').addEventListener('change', importCSV);
  }

  function exportCSV() {
    const status = $('#csv-status');
    if (!state.entries.length) {
      status.textContent = 'Nada para exportar — você ainda não tem lançamentos.';
      return;
    }
    const csv = M.entriesToCSV(state.entries, state.settings.categories);
    // BOM para o Excel reconhecer UTF-8 (acentos corretos).
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lancamentos-' + M.todayISO() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    status.textContent = 'Exportado ' + state.entries.length + ' lançamento(s).';
  }

  async function importCSV(e) {
    const status = $('#csv-status');
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = M.csvToEntries(text, state.settings.categories);

      if (parsed.entries.length === 0) {
        status.textContent = 'Nenhum lançamento válido encontrado no arquivo.' +
          (parsed.errors.length ? ' (' + parsed.errors.length + ' linha(s) com problema)' : '');
        e.target.value = '';
        return;
      }

      const resumo = parsed.entries.length + ' lançamento(s)' +
        (parsed.newCategories.length ? ' e ' + parsed.newCategories.length + ' categoria(s) nova(s)' : '') +
        (parsed.errors.length ? ' (' + parsed.errors.length + ' linha(s) ignorada(s))' : '');
      if (!confirm('Importar ' + resumo + '?')) { e.target.value = ''; return; }

      // Cria categorias novas antes dos lançamentos (para o id bater).
      if (parsed.newCategories.length) {
        parsed.newCategories.forEach((c) => {
          if (!state.settings.categories.some((x) => x.id === c.id)) {
            state.settings.categories.push(c);
          }
        });
        await Store.saveSettings(state.settings);
      }

      await Store.saveEntriesBatch(parsed.entries);
      state.entries = await Store.listEntries();
      renderAll();
      status.textContent = 'Importado: ' + resumo + '.';
    } catch (err) {
      status.textContent = 'Falha ao importar: ' + (err && err.message ? err.message : err);
    } finally {
      e.target.value = ''; // permite reimportar o mesmo arquivo
    }
  }

  // ==========================================================================
  //  CATEGORIAS
  // ==========================================================================
  function setupCategories() {
    $('#category-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#cat-name').value.trim();
      const icon = $('#cat-icon').value.trim() || '📦';
      const kind = $('#cat-kind').value;
      if (!name) return;
      const id = slug(name) || ('cat-' + Date.now().toString(36));
      if (state.settings.categories.some((c) => c.id === id)) {
        alert('Já existe uma categoria com esse nome.');
        return;
      }
      state.settings.categories.push({ id, name, icon, kind });
      await Store.saveSettings(state.settings);
      $('#cat-name').value = '';
      $('#cat-icon').value = '';
      renderCategories();
      fillCategoryDropdown();
    });
  }

  function renderCategories() {
    const list = $('#category-list');
    list.innerHTML = state.settings.categories.map((c) =>
      '<div class="cat-chip">' + c.icon + ' ' + escapeHTML(c.name) +
      ' <span class="kind">(' + (c.kind === 'income' ? 'receita' : 'despesa') + ')</span>' +
      '<button class="btn-icon btn-danger" data-delcat="' + c.id + '" title="Remover">✕</button>' +
      '</div>'
    ).join('');

    $$('[data-delcat]', list).forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.delcat;
        const used = state.entries.some((e) => e.categoryId === id);
        if (used && !confirm('Há lançamentos nesta categoria. Remover mesmo assim? ' +
          'Os lançamentos antigos continuam, mas ficarão sem categoria.')) return;
        state.settings.categories = state.settings.categories.filter((c) => c.id !== id);
        delete state.settings.budgets[id];
        await Store.saveSettings(state.settings);
        renderAll();
      })
    );
  }

  // ==========================================================================
  //  ASSISTENTE (CHAT por regras)
  // ==========================================================================
  function setupChat() {
    const form = $('#chat-form');
    const input = $('#chat-input');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      askAssistant(q);
      input.value = '';
    });

    $$('#chat-suggestions .chip').forEach((chip) =>
      chip.addEventListener('click', () => askAssistant(chip.dataset.q))
    );

    // mensagem de boas-vindas
    addChatMessage('bot',
      'Olá! Sou seu assistente financeiro. Pergunte sobre o mês selecionado — ' +
      'por exemplo: "qual meu saldo?", "onde gastei mais?", "onde posso cortar?", ' +
      '"qual a tendência?" ou "e minhas metas?".');
  }

  function askAssistant(question) {
    addChatMessage('user', question);
    const answer = M.answerQuestion(
      question, state.entries, state.monthKey,
      state.settings.categories, state.settings.budgets, state.settings.goals
    );
    // pequeno atraso para dar sensação de resposta
    setTimeout(() => addChatMessage('bot', answer), 180);
  }

  function addChatMessage(who, text) {
    const log = $('#chat-log');
    const div = document.createElement('div');
    div.className = 'msg ' + who;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ==========================================================================
  //  UTILIDADES
  // ==========================================================================
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function slug(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  }
  function formatDate(iso) {
    const [y, m, d] = String(iso).split('-');
    if (!y || !m || !d) return iso;
    return d + '/' + m + '/' + y;
  }

  // ==========================================================================
  //  BOOTSTRAP DA APLICAÇÃO
  // ==========================================================================
  function enterApp() {
    hide($('#auth-screen'));
    show($('#app'));
    $('#user-email').textContent = state.user ? state.user.email : '';
  }
  function enterAuth() {
    show($('#auth-screen'));
    hide($('#app'));
  }

  async function init() {
    // Mostra o login por padrão no boot; onAuth corrige se já houver sessão.
    enterAuth();

    setupAuthUI();
    setupNav();
    setupEntries();
    setupGoals();
    setupCSV();
    setupCategories();
    setupChat();

    $('#logout-btn').addEventListener('click', async () => {
      if (Store.mode === 'local') {
        alert('Em modo local não há login. Configure o Firebase para habilitar.');
        return;
      }
      await Store.logout();
    });

    // Reage ao estado de autenticação (local = já logado; firebase = real).
    Store.onAuth(async (user) => {
      // Acesso negado pela allowlist: volta ao login com aviso claro.
      if (user && user.denied) {
        state.user = null;
        enterAuth();
        const box = $('#auth-error');
        box.textContent = 'O e-mail ' + (user.email || '') +
          ' não tem permissão de acesso. Fale com o responsável para ser liberado.';
        show(box);
        return;
      }
      state.user = user;
      if (user) {
        await loadData();
        enterApp();
        renderAll();
      } else {
        enterAuth();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
