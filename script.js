// script.js
// Client side for Telegram mini app + Firebase (web) + server API calls
// Replace API_BASE_URL with your deployed backend URL (no trailing slash)

const API_BASE_URL = "https://your-backend.example.com"; // <-- set to your server URL

/* ============= FIREBASE (web) ============== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
  authDomain: "taskup-9ba7b.firebaseapp.com",
  projectId: "taskup-9ba7b",
  storageBucket: "taskup-9ba7b.appspot.com",
  messagingSenderId: "319481101196",
  appId: "1:319481101196:web:6cded5be97620d98d974a9",
  measurementId: "G-JNNLG1E49L"
};

const TELEGRAM_BOT_USERNAME = "TaskItUpBot"; // given

// init firebase
if (!window.firebase || !window.firebase.firestore) {
  console.error("Make sure Firebase web SDK scripts are included in HTML.");
}
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

/* ============= Telegram WebApp ============== */
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.expand?.();
  tg.ready();
}

/* ============= App constants ============== */
const DAILY_AD_LIMIT = 40;
const AD_REWARD = 250;
const JOIN_TASK_REWARD = 300;
const WITHDRAW_MIN = 10000;
const TASK_ID_JOIN_CHANNEL = "channel_1";

/* ============= element refs (adapt if your HTML differs) ============== */
const els = {
  homeUsername: document.getElementById("home-username"),
  balanceHome: document.getElementById("balance-home"),
  adsWatchedToday: document.getElementById("ads-watched-today"),
  adsLeftToday: document.getElementById("ads-left-today"),
  tasksCompleted: document.getElementById("tasks-completed"),
  progressBar: document.getElementById("task-progress-bar"),
  startTaskButton: document.getElementById("start-task-button"),
  withdrawBalance: document.getElementById("withdraw-balance"),
  withdrawAmountInput: document.getElementById("withdraw-amount"),
  withdrawMethodSelect: document.getElementById("withdraw-method"),
  walletIdInput: document.getElementById("wallet-id"),
  historyList: document.getElementById("history-list"),
  profileName: document.getElementById("profile-name"),
  telegramUsername: document.getElementById("telegram-username"),
  profileBalance: document.getElementById("profile-balance"),
  referralLinkInput: document.getElementById("referral-link"),
  profileReferralLink: document.getElementById("profile-referral-link"),
  referCountEl: document.getElementById("refer-count"),
  referEarningsEl: document.getElementById("refer-earnings"),
  earnedSoFarEl: document.getElementById("earned-so-far"),
  totalAdsViewedEl: document.getElementById("total-ads-viewed"),
  totalRefersEl: document.getElementById("total-refers")
};

/* ============= USER context ============== */
let USER = {
  uid: null,
  tgUser: null,
  username: "User",
  firstName: "",
  lastName: "",
  balance: 0,
  adsViewedToday: 0,
  lastReset: null,
  earnedSoFar: 0,
  totalAdsViewed: 0,
  referrals: [],
  referralEarnings: 0
};

function getUidFromTelegram() {
  try {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      return `tg_${u.id}`;
    }
  } catch (e) {}
  let local = localStorage.getItem("local_uid");
  if (!local) {
    local = "local_" + Math.random().toString(36).slice(2, 11);
    localStorage.setItem("local_uid", local);
  }
  return local;
}
function nowISO(){ return new Date().toISOString(); }

/* ============= Firestore helpers ============== */
async function loadUserFromFirestore(uid){
  const docRef = db.collection("users").doc(uid);
  const doc = await docRef.get();
  return doc.exists ? doc.data() : null;
}
async function createOrEnsureUser(uid, userData){
  const docRef = db.collection("users").doc(uid);
  const doc = await docRef.get();
  if (!doc.exists) {
    const payload = {
      username: userData.username || USER.username,
      firstName: userData.firstName || USER.firstName,
      lastName: userData.lastName || USER.lastName,
      balance: userData.balance ?? 0,
      adsViewedToday: userData.adsViewedToday ?? 0,
      lastReset: userData.lastReset || nowISO(),
      earnedSoFar: userData.earnedSoFar ?? 0,
      totalAdsViewed: userData.totalAdsViewed ?? 0,
      referrals: userData.referrals ?? [],
      referralEarnings: userData.referralEarnings ?? 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await docRef.set(payload);
    return payload;
  } else return doc.data();
}
async function saveUserToFirestore(uid, payload){
  const docRef = db.collection("users").doc(uid);
  payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  await docRef.set(payload, { merge: true });
}

/* ============= UI rendering ============== */
function renderUserToUI(){
  if (!els.homeUsername) return;
  els.homeUsername.textContent = USER.firstName || USER.username || "User";
  els.balanceHome.textContent = Math.floor(USER.balance || 0);
  els.withdrawBalance.textContent = Math.floor(USER.balance || 0);
  els.profileName.textContent = USER.firstName ? `${USER.firstName} ${USER.lastName || ""}`.trim() : USER.username || "User";
  els.telegramUsername.textContent = USER.tgUser && USER.tgUser.username ? `@${USER.tgUser.username}` : (USER.username ? `@${USER.username}` : "@username");
  els.profileBalance.textContent = Math.floor(USER.balance || 0);
  els.earnedSoFarEl.textContent = Math.floor(USER.earnedSoFar || 0);
  els.totalAdsViewedEl.textContent = Math.floor(USER.totalAdsViewed || 0);
  els.totalRefersEl.textContent = (Array.isArray(USER.referrals) ? USER.referrals.length : (USER.referrals || 0));
  els.referCountEl.textContent = (Array.isArray(USER.referrals) ? USER.referrals.length : (USER.referrals || 0));
  els.referEarningsEl.textContent = Math.floor(USER.referralEarnings || 0);

  const adsToday = USER.adsViewedToday || 0;
  const left = Math.max(DAILY_AD_LIMIT - adsToday, 0);
  els.adsWatchedToday.textContent = adsToday;
  els.adsLeftToday.textContent = left;
  els.tasksCompleted.textContent = adsToday;
  const pct = Math.min(100, Math.round((adsToday/DAILY_AD_LIMIT) * 100));
  els.progressBar.style.width = pct + "%";
  els.startTaskButton.disabled = adsToday >= DAILY_AD_LIMIT;
}

/* ============= Daily reset ============== */
function needsDailyReset(lastResetIso){
  if (!lastResetIso) return true;
  const last = new Date(lastResetIso);
  const now = new Date();
  return last.toISOString().slice(0,10) !== now.toISOString().slice(0,10);
}
async function checkAndResetDailyCountsIfNeeded(){
  if (!USER.lastReset || needsDailyReset(USER.lastReset)){
    USER.adsViewedToday = 0;
    USER.lastReset = nowISO();
    await saveUserToFirestore(USER.uid, { adsViewedToday: 0, lastReset: USER.lastReset });
    renderUserToUI();
  }
}

/* ============= Ad flow (client-simulated) ============== */
let adInProgress = false;
async function completeAdTask(){
  if (adInProgress) return;
  if (USER.adsViewedToday >= DAILY_AD_LIMIT){
    alert("You've reached the daily ads limit.");
    return;
  }
  adInProgress = true;
  els.startTaskButton.disabled = true;
  els.startTaskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Playing...';
  try {
    await new Promise(res => setTimeout(res, 6000)); // simulate ad
    await onAdWatched();
  } catch(e){
    console.error(e);
    alert("Ad failed. Try again.");
  } finally {
    adInProgress = false;
    els.startTaskButton.innerHTML = '<i class="fas fa-play-circle"></i> Watch Ad';
    els.startTaskButton.disabled = USER.adsViewedToday >= DAILY_AD_LIMIT;
  }
}
async function onAdWatched(){
  USER.adsViewedToday = (USER.adsViewedToday || 0) + 1;
  USER.totalAdsViewed = (USER.totalAdsViewed || 0) + 1;
  USER.balance = (USER.balance || 0) + AD_REWARD;
  USER.earnedSoFar = (USER.earnedSoFar || 0) + AD_REWARD;
  await saveUserToFirestore(USER.uid, {
    adsViewedToday: USER.adsViewedToday,
    totalAdsViewed: USER.totalAdsViewed,
    balance: USER.balance,
    earnedSoFar: USER.earnedSoFar
  });
  renderUserToUI();
}

/* ============= Join-channel verification (server-backed) ============== */
function attachJoinTaskHandlers(){
  const joinCard = document.querySelector("#task-channel_1");
  if (!joinCard) return;
  const joinBtn = joinCard.querySelector(".join-btn");
  const verifyBtn = joinCard.querySelector(".verify-btn");
  const doneElement = joinCard.querySelector(".task-done");

  const doneKey = `task_done_${TASK_ID_JOIN_CHANNEL}_${USER.uid}`;
  const done = localStorage.getItem(doneKey) === "1" || (USER.completedTasks && USER.completedTasks.includes(TASK_ID_JOIN_CHANNEL));
  if (done){
    joinCard.classList.add("completed");
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verified";
    doneElement.style.display = "flex";
  }

  joinBtn.addEventListener("click", () => {
    const url = joinCard.dataset.url;
    // open channel link in new tab. user must actually join using Telegram client.
    window.open(url, "_blank");
    verifyBtn.disabled = false;
  });

  verifyBtn.addEventListener("click", async () => {
    if (verifyBtn.disabled) return;
    try {
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Verifying...";
      // send server the telegram user id and the chat username/id to verify membership
      const payload = {
        uid: USER.uid,
        // If available, include tg user id
        tg_user_id: (USER.tgUser && USER.tgUser.id) ? USER.tgUser.id : null,
        // supply the channel chat username or id (from data attribute)
        channel_username: joinCard.dataset.chat || joinCard.dataset.username || joinCard.dataset.url
      };
      const resp = await fetch(`${API_BASE_URL}/api/verify-join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || "Verification failed");
      // success — server will award reward and update user's Firestore doc
      localStorage.setItem(doneKey, "1");
      // refresh user doc from firestore to pick up new balance
      const fresh = await loadUserFromFirestore(USER.uid);
      if (fresh) USER = { ...USER, ...fresh };
      joinCard.classList.add("completed");
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Verified";
      doneElement.style.display = "flex";
      renderUserToUI();
      alert(`+${JOIN_TASK_REWARD} PEPE — Verified!`);
    } catch (err) {
      console.error("verify join error", err);
      alert("Verification failed: " + (err.message || err));
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verify";
    }
  });
}

/* ============= Withdraw (calls server to create withdrawal & atomically deduct balance) ============== */
async function submitWithdrawal(){
  const amount = Number(els.withdrawAmountInput.value || 0);
  const walletId = els.walletIdInput.value && els.walletIdInput.value.trim();
  const method = els.withdrawMethodSelect.value || "binancepay";

  if (!walletId) { alert("Enter your wallet/binance/email ID."); return; }
  if (!amount || amount < WITHDRAW_MIN) { alert(`Minimum withdraw amount is ${WITHDRAW_MIN} PEPE.`); return; }
  if (amount > USER.balance) { alert("Insufficient balance."); return; }

  try {
    const payload = {
      uid: USER.uid,
      amount: Math.floor(amount),
      method,
      walletId
    };
    const resp = await fetch(`${API_BASE_URL}/api/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j?.error || "Withdraw failed");

    // success: refresh local user from firestore (server updated balance)
    const fresh = await loadUserFromFirestore(USER.uid);
    if (fresh) USER = { ...USER, ...fresh };
    renderUserToUI();
    appendHistoryItem(j.withdrawal || { amount: payload.amount, status: "pending", createdAt: new Date().toISOString() });
    els.withdrawAmountInput.value = "";
    els.walletIdInput.value = "";
    alert("Withdrawal request submitted successfully.");
  } catch (err) {
    console.error("withdraw error", err);
    alert("Withdrawal failed: " + (err.message || err));
  }
}

/* ============= History append for client display ============== */
function appendHistoryItem(item) {
  const container = els.historyList;
  const noHistory = container?.querySelector(".no-history");
  if (noHistory) noHistory.remove();
  const div = document.createElement("div");
  div.className = `history-item ${item.status === "completed" ? "completed" : "pending"}`;
  const details = document.createElement("div");
  details.className = "history-details";
  const amount = document.createElement("div");
  amount.className = "history-amount";
  amount.textContent = `${item.amount} PEPE`;
  const date = document.createElement("div");
  date.className = "history-date";
  if (item.createdAt && item.createdAt.toDate) date.textContent = item.createdAt.toDate().toLocaleString();
  else date.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : (new Date()).toLocaleString();
  details.appendChild(amount);
  details.appendChild(date);
  const status = document.createElement("div");
  status.className = `history-status ${item.status === "completed" ? "completed" : "pending"}`;
  status.textContent = item.status === "completed" ? "Completed" : "Pending";
  div.appendChild(details);
  div.appendChild(status);
  container?.prepend(div);
}

/* ============= Referral link ============== */
function generateReferralLink(){
  // Use official bot username so Telegram will open a chat with start param
  const baseBot = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
  const ref = encodeURIComponent(USER.uid);
  return `${baseBot}?start=ref_${ref}`;
}
function copyReferralLink(button, inputId){
  const text = inputId ? document.getElementById(inputId).value : (els.referralLinkInput.value || generateReferralLink());
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => alert("Referral link copied!")).catch(async () => {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); alert("Referral link copied!"); } catch(e){ alert("Copy failed — select and copy manually: " + text); }
    ta.remove();
  });
}

/* ============= Tabs & modal helpers ============== */
function showTab(tabId, el){ document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active")); document.getElementById(tabId).classList.add("active"); document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active")); if (el) el.classList.add("active"); }
function openReferModal(){ document.getElementById("refer-modal").style.display = "flex"; }
function closeReferModal(){ document.getElementById("refer-modal").style.display = "none"; }

/* ============= Startup ============== */
async function startApp(){
  USER.uid = getUidFromTelegram();
  USER.tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null;
  if (USER.tgUser) {
    USER.username = USER.tgUser.username || USER.tgUser.id;
    USER.firstName = USER.tgUser.first_name || "";
    USER.lastName = USER.tgUser.last_name || "";
  } else {
    USER.username = localStorage.getItem("web_username") || ("guest_" + USER.uid.slice(-5));
  }

  try {
    const existing = await loadUserFromFirestore(USER.uid);
    if (existing) USER = { ...USER, ...existing, uid: USER.uid, tgUser: USER.tgUser };
    else {
      const created = await createOrEnsureUser(USER.uid, {
        username: USER.username,
        firstName: USER.firstName,
        lastName: USER.lastName,
        balance: 0,
        adsViewedToday: 0,
        lastReset: nowISO(),
        earnedSoFar: 0,
        totalAdsViewed: 0,
        referrals: [],
        referralEarnings: 0
      });
      USER = { ...USER, ...created, uid: USER.uid, tgUser: USER.tgUser };
    }
  } catch(err){
    console.error("Failed to load/create user:", err);
    alert("Failed to connect to backend (Firestore). Check config.");
  }

  await checkAndResetDailyCountsIfNeeded();
  renderUserToUI();

  const rlink = generateReferralLink();
  if (els.referralLinkInput) els.referralLinkInput.value = rlink;
  if (els.profileReferralLink) els.profileReferralLink.value = rlink;

  attachJoinTaskHandlers();
  await loadWithdrawalHistory();

  // listen for live updates
  db.collection("users").doc(USER.uid).onSnapshot(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    USER.balance = data.balance ?? USER.balance;
    USER.adsViewedToday = data.adsViewedToday ?? USER.adsViewedToday;
    USER.lastReset = data.lastReset ?? USER.lastReset;
    USER.earnedSoFar = data.earnedSoFar ?? USER.earnedSoFar;
    USER.totalAdsViewed = data.totalAdsViewed ?? USER.totalAdsViewed;
    USER.referrals = data.referrals ?? USER.referrals;
    USER.referralEarnings = data.referralEarnings ?? USER.referralEarnings;
    renderUserToUI();
  });
}

/* ============= Load withdraw history (client) ============== */
async function loadWithdrawalHistory(){
  try {
    const snap = await db.collection("withdrawals").where("userId", "==", USER.uid).orderBy("createdAt", "desc").limit(20).get();
    els.historyList.innerHTML = "";
    if (snap.empty) {
      const p = document.createElement("p"); p.className = "no-history"; p.textContent = "You have no withdrawal history yet."; els.historyList.appendChild(p); return;
    }
    snap.forEach(doc => appendHistoryItem({ id: doc.id, ...doc.data() }));
  } catch(err){
    console.error("loadWithdrawalHistory", err);
  }
}

/* ============= Wire up global functions ============== */
window.showTab = showTab;
window.openReferModal = openReferModal;
window.closeReferModal = closeReferModal;
window.copyReferralLink = copyReferralLink;
window.completeAdTask = completeAdTask;
window.submitWithdrawal = submitWithdrawal;

/* ============= Init ============== */
document.addEventListener("DOMContentLoaded", () => {
  if (!firebase || !db) console.error("Firebase not initialized.");
  startApp().catch(err => console.error("startApp err", err));
  const modal = document.getElementById("refer-modal");
  modal?.addEventListener("click", (e) => { if (e.target === modal) closeReferModal(); });
});
