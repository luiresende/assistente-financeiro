// ============================================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================================
// Preencha com as credenciais do SEU projeto Firebase (novo, só de finanças).
// Enquanto os valores começarem com "COLE_AQUI_", o app roda em MODO LOCAL
// (dados no localStorage do navegador), sem login — ótimo para testar.
//
// Onde pegar: console.firebase.google.com -> seu projeto -> Configurações do
// projeto (engrenagem) -> Seus apps -> App da Web -> Configuração do SDK.
//
// Estes valores NÃO são secretos: identificam o projeto no cliente. O controle
// de acesso real é feito pelas Security Rules do Firestore (firestore.rules)
// e pelo Firebase Authentication.
// ============================================================================

window.FIREBASE_CONFIG = {
  apiKey: "COLE_AQUI_API_KEY",
  authDomain: "COLE_AQUI_AUTH_DOMAIN",
  projectId: "COLE_AQUI_PROJECT_ID",
  storageBucket: "COLE_AQUI_STORAGE_BUCKET",
  messagingSenderId: "COLE_AQUI_MESSAGING_SENDER_ID",
  appId: "COLE_AQUI_APP_ID"
};
