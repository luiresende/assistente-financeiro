// ============================================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================================
// Projeto: assistente-financeiro-ea1ee
// Estes valores NÃO são secretos: identificam o projeto no cliente. O controle
// de acesso real é feito pela ALLOWLIST + Firestore Security Rules
// (firestore.rules) e pelo Firebase Authentication.
//
// Observação: usamos o SDK "compat" (ver os <script> no index.html), por isso
// a config é apenas este objeto global — sem import/initializeApp aqui. O
// Store (js/store.js) chama firebase.initializeApp() quando a config é real.
// ============================================================================

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAUiYieKWC0NuoJ0HGTE6JtgZ2GipZfxOw",
  authDomain: "assistente-financeiro-ea1ee.firebaseapp.com",
  projectId: "assistente-financeiro-ea1ee",
  storageBucket: "assistente-financeiro-ea1ee.firebasestorage.app",
  messagingSenderId: "72030958093",
  appId: "1:72030958093:web:9cca7bebcc63d97d361b44"
};
