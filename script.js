const firebaseConfig = {
  apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
  authDomain: "taskup-9ba7b.firebaseapp.com",
  projectId: "taskup-9ba7b",
  storageBucket: "taskup-9ba7b.appspot.com",
  messagingSenderId: "319481101196",
  appId: "1:319481101196:web:6cded5be97620d98d974a9"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let userId = null;
let userData = {};
let initialized = false;

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const COMMISSION_PERCENT = 10;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";

// 🔑 Extract referral from start_param or session
function getReferrerId() {
  const startParam = Telegram.WebApp.initDataUnsafe.start_param;
  const refFromUrl = new URLSearchParams(window.location.search).get("ref");
  const refFromSession = sessionStorage.getItem("referrerId");
  return startParam || refFromUrl || refFromSession;
}

// 👤 Get placeholder if testing in browser
function getTestUserId() {
  let id = localStorage.getItem("userId");
  if (!id) {
    id = "test_" + Date.now();
    localStorage.setItem("userId", id);
  }
  return id;
}

// 🚀 App entry
document.addEventListener("DOMContentLoaded", () => {
  const storedRef = getReferrerId();
  if (storedRef) sessionStorage.setItem("referrerId", storedRef);

  if (Telegram.WebApp.initDataUnsafe?.user) {
    Telegram.WebApp.ready();
    startApp(Telegram.WebApp.initDataUnsafe.user, storedRef);
  } else {
    startApp(null, storedRef); // test mode
  }
});
