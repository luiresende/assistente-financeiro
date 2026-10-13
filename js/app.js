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
    settings: { categories: [], budgets: {} },
    monthKey: M.currentMonthKey(),
    user: null,
  };

  let chart = null;

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
      'por exemplo: "qual meu saldo?", "onde gastei mais?" ou "onde posso cortar?".');
  }

  function askAssistant(question) {
    addChatMessage('user', question);
    const answer = M.answerQuestion(
      question, state.entries, state.monthKey, state.settings.categories, state.settings.budgets
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
