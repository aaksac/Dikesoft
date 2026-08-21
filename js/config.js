/*
  config.js
  Görev: Firebase ve uygulama genel ayarları.
  Not: Firebase Authentication kullanıcıları Firebase Console üzerinden eklenir.
*/

export const firebaseConfig = {
  apiKey: "AIzaSyA3Xl9_2e5vDkuzDDb30dNRgBwuySCyhZQ",
  authDomain: "dikesoft-5d174.firebaseapp.com",
  projectId: "dikesoft-5d174",
  storageBucket: "dikesoft-5d174.firebasestorage.app",
  messagingSenderId: "349741595895",
  appId: "1:349741595895:web:22740454bd42aabd35e7f2",
  measurementId: "G-23JME4J54P"
};

export const appConfig = {
  appName: "Dikesoft",
  currency: "TRY",
  locale: "tr-TR",
  allowedFileTypes: [".xlsx", ".xls", ".csv"],
  maxRows: 10000
};


export const databaseConfig = {
  // SQL/Supabase bağlantısı zorunludur.
  // Supabase > Project Settings > API ekranından aşağıdaki iki alanı doldurun.
  //
  // Örnek:
  // supabaseUrl: "https://fidgduwmijucgavodpgb.supabase.co"
  // supabaseAnonKey: "sb_publishable_ZEq-cwiO62yWu8gHkNMoSQ_kheGzD3z"
  supabaseUrl: "https://fidgduwmijucgavodpgb.supabase.co",
  supabaseAnonKey: "sb_publishable_ZEq-cwiO62yWu8gHkNMoSQ_kheGzD3z",

  // SQL-only modda false olmalıdır. Veri cache/localStorage'a kaydedilmez.
  allowLocalFallback: false
};


export const mailConfig = {
  fromName: "Veriteam",
  appsScriptWebAppUrl: "https://script.google.com/macros/s/AKfycby2Pg7DF21d6354h1eDWQqMoA9FX2c9A_tCHOT6ywVfKhq8pSMoDaZsPtv047XpgEhCSw/exec",
  mailToken: "AliDikesoft2026MailToken"
};
