// ============================================================================
// STORE: persistência + autenticação do assistente financeiro
// ----------------------------------------------------------------------------
// Decide automaticamente entre:
//   - MODO FIREBASE: Authentication (e-mail/senha) + Firestore, quando o
//                    firebase-config.js tem credenciais reais e o SDK carregou.
//   - MODO LOCAL   : localStorage (sem login), para desenvolvimento e testes.
//
// Modelo de dados (POR USUÁRIO — cada um só enxerga o próprio):
//   users/{uid}/entries/{id}   -> lançamento { id, type, amount, date,
//                                   categoryId, note }
//   users/{uid}/meta/settings  -> { categories:[...], budgets:{catId:limite} }
//
// Essa separação por uid + as Security Rules (firestore.rules) garantem que
// um usuário jamais lê os dados de outro.
// ============================================================================

(function () {
  const LS_ENTRIES = 'financas.entries.v1';
  const LS_SETTINGS = 'financas.settings.v1';

  // ==========================================================================
  //  ALLOWLIST — controle de acesso: SÓ estes e-mails podem usar o app.
  // --------------------------------------------------------------------------
  //  Um e-mail fora desta lista até consegue criar login no Firebase Auth, mas
  //  é imediatamente deslogado pelo app e NÃO lê/escreve nada (as Firestore
  //  Security Rules barram no servidor — ver firestore.rules).
  //
  //  >>> MANTENHA ESTA LISTA EM SINCRONIA com allowed() em firestore.rules. <<<
  //  Para dar acesso a alguém: adicione o e-mail (minúsculo) nos DOIS lugares
  //  e republique as regras no console do Firebase.
  // ==========================================================================
  const ALLOWED_EMAILS = [
    'lcresendealm@gmail.com',
  ];

  function norm(email) {
    return (email || '').trim().toLowerCase();
  }

  function isAllowed(email) {
    return ALLOWED_EMAILS.map(norm).includes(norm(email));
  }

  function configLooksReal(cfg) {
    if (!cfg) return false;
    return Object.values(cfg).every(
      (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('COLE_AQUI_')
    );
  }

  const configOk = configLooksReal(window.FIREBASE_CONFIG);
  const sdkOk = typeof window.firebase !== 'undefined';
  const useFirebase = configOk && sdkOk;

  console.log(
    '[Store] config real?', configOk,
    '| SDK Firebase carregado?', sdkOk,
    '| modo =', useFirebase ? 'FIREBASE' : 'LOCAL'
  );

  // Faixa de aviso visível quando a config está certa mas o SDK não carregou
  // (ex.: rede corporativa bloqueando gstatic.com/firebasejs).
  if (configOk && !sdkOk) {
    window.addEventListener('DOMContentLoaded', function () {
      const bar = document.createElement('div');
      bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;' +
        'padding:12px 16px;font:13px/1.4 Segoe UI,sans-serif;text-align:center';
      bar.textContent =
        'Firebase não carregou (SDK bloqueado pela rede). Rodando em modo local.';
      document.body.appendChild(bar);
    });
  }

  function uid4() {
    return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Configurações padrão (categorias de fábrica, orçamentos vazios).
  function defaultSettings() {
    return {
      categories: window.Model.DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      budgets: {},
    };
  }

  // ==========================================================================
  //  MODO LOCAL (fallback de desenvolvimento, sem login)
  // ==========================================================================
  const LocalStore = {
    mode: 'local',
    currentUser: { email: 'local@dev' },

    onAuth(cb) {
      cb(this.currentUser); // já "logado" como usuário local
      return () => {};
    },
    async login() { throw new Error('Login indisponível em modo local.'); },
    async signup() { throw new Error('Cadastro indisponível em modo local.'); },
    async logout() {},

    async listEntries() {
      try {
        return JSON.parse(localStorage.getItem(LS_ENTRIES)) || [];
      } catch { return []; }
    },
    async saveEntry(entry) {
      const list = await this.listEntries();
      const e = { ...entry };
      if (!e.id) e.id = uid4();
      const idx = list.findIndex((x) => x.id === e.id);
      if (idx >= 0) list[idx] = e; else list.push(e);
      localStorage.setItem(LS_ENTRIES, JSON.stringify(list));
      return e;
    },
    async removeEntry(id) {
      const list = (await this.listEntries()).filter((x) => x.id !== id);
      localStorage.setItem(LS_ENTRIES, JSON.stringify(list));
    },

    async getSettings() {
      try {
        const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
        return s && s.categories ? s : defaultSettings();
      } catch { return defaultSettings(); }
    },
    async saveSettings(settings) {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
      return settings;
    },
  };

  // ==========================================================================
  //  MODO FIREBASE (Auth e-mail/senha + Firestore, dados por uid)
  // ==========================================================================
  function makeFirebaseStore() {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    const auth = firebase.auth();
    const db = firebase.firestore();

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    let current = null; // { uid, email }

    function userDoc() {
      if (!current) throw new Error('Não autenticado.');
      return db.collection('users').doc(current.uid);
    }
    function entriesCol() { return userDoc().collection('entries'); }
    function settingsRef() { return userDoc().collection('meta').doc('settings'); }

    return {
      mode: 'firebase',
      get currentUser() { return current; },

      onAuth(cb) {
        return auth.onAuthStateChanged(async (fbUser) => {
          if (!fbUser) {
            current = null;
            cb(null);
            return;
          }
          const email = norm(fbUser.email);
          // CONTROLE DE ACESSO: e-mail fora da allowlist é deslogado na hora.
          // (As Security Rules também barram no servidor — defesa em camadas.)
          if (!isAllowed(email)) {
            current = null;
            try { await auth.signOut(); } catch (_) {}
            cb({ denied: true, email });
            return;
          }
          current = { uid: fbUser.uid, email };
          cb(current);
        });
      },

      async login(email, password) {
        if (!isAllowed(email)) {
          const err = new Error('E-mail sem permissão de acesso.');
          err.code = 'app/not-allowed';
          throw err;
        }
        await auth.signInWithEmailAndPassword(norm(email), password);
      },
      async signup(email, password) {
        // Impede criar conta para e-mail fora da allowlist.
        if (!isAllowed(email)) {
          const err = new Error('E-mail sem permissão de acesso.');
          err.code = 'app/not-allowed';
          throw err;
        }
        await auth.createUserWithEmailAndPassword(norm(email), password);
      },
      async logout() { await auth.signOut(); },

      async listEntries() {
        const snap = await entriesCol().orderBy('date', 'desc').get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      async saveEntry(entry) {
        const e = { ...entry };
        if (!e.id) e.id = uid4();
        const id = e.id;
        delete e.id; // não gravamos o id dentro do doc
        await entriesCol().doc(id).set(e, { merge: true });
        return { id, ...e };
      },
      async removeEntry(id) {
        await entriesCol().doc(id).delete();
      },

      async getSettings() {
        const doc = await settingsRef().get();
        if (!doc.exists) {
          const def = defaultSettings();
          await settingsRef().set(def);
          return def;
        }
        const data = doc.data();
        // Garante estrutura mínima mesmo em docs antigos/parciais.
        return {
          categories: Array.isArray(data.categories) && data.categories.length
            ? data.categories
            : defaultSettings().categories,
          budgets: data.budgets || {},
        };
      },
      async saveSettings(settings) {
        await settingsRef().set(settings, { merge: true });
        return settings;
      },
    };
  }

  window.Store = useFirebase ? makeFirebaseStore() : LocalStore;

  // helpers expostos
  window.Store.normEmail = norm;
  window.Store.defaultSettings = defaultSettings;
  window.Store.isAllowed = isAllowed;        // allowlist (ver ALLOWED_EMAILS)
  window.Store.allowedEmails = ALLOWED_EMAILS;
})();
