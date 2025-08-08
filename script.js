// --- [Firebase Initialization] ---
const firebaseConfig = {
  apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
  authDomain: "taskup-9ba7b.firebaseapp.com",
  projectId: "taskup-9ba7b",
  storageBucket: "taskup-9ba7b.appspot.com",
  messagingSenderId: "319481101196",
  appId: "1:319481101196:web:6cded5be97620d98d974a9",
  measurementId: "G-JNNLG1E49L"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- [Global Variables] ---
let telegramUserId = null;
let userState = {};
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- [App Initialization] ---
function initializeApp(tgUser, refFromSession = null) {
  telegramUserId = tgUser ? tgUser.id.toString() : getTestUserId();
  const startParam = Telegram?.WebApp?.initDataUnsafe?.start_param;
  const referrerId = startParam || refFromSession;

  const userRef = db.collection("users").doc(telegramUserId);

  userRef.onSnapshot(async (doc) => {
    if (!doc.exists) {
      const newUserData = {
        username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ""}`.trim() : "User",
        telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`,
        profilePicUrl: `https://i.pravatar.cc/150?u=${telegramUserId}`,
        balance: 0,
        tasksCompletedToday: 0,
        lastTaskTimestamp: null,
        totalEarned: 0,
        totalAdsViewed: 0,
        totalRefers: 0,
        joinedBonusTasks: [],
        referredBy: referrerId || null,
        referralEarnings: 0
      };

      if (referrerId) {
        const refDocRef = db.collection("users").doc(referrerId);
        try {
          await db.runTransaction(async (tx) => {
            const refDoc = await tx.get(refDocRef);
            if (!refDoc.exists) throw "Referrer not found";
            tx.update(refDocRef, {
              totalRefers: firebase.firestore.FieldValue.increment(1)
            });
            tx.set(userRef, newUserData);
          });
        } catch (e) {
          console.warn("Referral failed:", e);
          await userRef.set(newUserData);
        }
      } else {
        await userRef.set(newUserData);
      }
    } else {
      userState = doc.data();
    }

    if (!isInitialized) {
      setupTaskListeners();
      loadWithdrawalHistory();
      isInitialized = true;
    }

    updateUI();
  });
}

// --- [Referral Commission] ---
async function payReferralCommission(amount) {
  const referrerId = userState.referredBy;
  if (!referrerId) return;

  const commission = Math.floor(amount * REFERRAL_COMMISSION_RATE);
  if (commission <= 0) return;

  try {
    await db.collection("users").doc(referrerId).update({
      balance: firebase.firestore.FieldValue.increment(commission),
      referralEarnings: firebase.firestore.FieldValue.increment(commission)
    });
  } catch (err) {
    console.error("Failed to pay commission:", err);
  }
}

// --- [UI Update] ---
function updateUI() {
  const balance = Math.floor(userState.balance || 0).toLocaleString();
  const earned = Math.floor(userState.totalEarned || 0).toLocaleString();
  const refers = userState.totalRefers || 0;
  const referralEarnings = userState.referralEarnings || 0;

  document.getElementById("balance-home").textContent = balance;
  document.getElementById("withdraw-balance").textContent = balance;
  document.getElementById("profile-balance").textContent = balance;
  document.getElementById("home-username").textContent = userState.username;
  document.getElementById("profile-name").textContent = userState.username;
  document.getElementById("telegram-username").textContent = userState.telegramUsername;
  document.getElementById("ads-watched-today").textContent = userState.tasksCompletedToday || 0;
  document.getElementById("ads-left-today").textContent = DAILY_TASK_LIMIT - (userState.tasksCompletedToday || 0);
  document.getElementById("tasks-completed").textContent = `${userState.tasksCompletedToday || 0} / ${DAILY_TASK_LIMIT}`;
  document.getElementById("task-progress-bar").style.width = `${(userState.tasksCompletedToday || 0) / DAILY_TASK_LIMIT * 100}%`;
  document.getElementById("earned-so-far").textContent = earned;
  document.getElementById("total-ads-viewed").textContent = userState.totalAdsViewed || 0;
  document.getElementById("total-refers").textContent = refers;
  document.getElementById("refer-earnings").textContent = referralEarnings;
  document.getElementById("refer-count").textContent = refers;

  (userState.joinedBonusTasks || []).forEach(taskId => {
    const taskCard = document.getElementById(`task-${taskId}`);
    if (taskCard) taskCard.classList.add("completed");
  });
}

// --- [Ad Tasks] ---
window.completeAdTask = async function () {
  if (!userState || userState.tasksCompletedToday >= DAILY_TASK_LIMIT) {
    alert("You have completed all ad tasks for today!");
    return;
  }

  const btn = document.getElementById("start-task-button");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';

  try {
    await window.show_9685198();
    await db.collection("users").doc(telegramUserId).update({
      balance: firebase.firestore.FieldValue.increment(AD_REWARD),
      totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
      tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
      totalAdsViewed: firebase.firestore.FieldValue.increment(1),
      lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    await payReferralCommission(AD_REWARD);
    alert(`Success! You earned ${AD_REWARD} PEPE.`);
  } catch (e) {
    console.error(e);
    alert("Ad failed. Try again.");
  } finally {
    updateUI();
  }
};

// --- [Bonus Task Verify] ---
async function handleVerifyClick(taskId, reward) {
  if (userState.joinedBonusTasks.includes(taskId)) {
    alert("Task already completed.");
    return;
  }

  const card = document.getElementById(`task-${taskId}`);
  const verifyBtn = card.querySelector(".verify-btn");
  verifyBtn.disabled = true;
  verifyBtn.textContent = "Verifying...";

  try {
    await db.collection("users").doc(telegramUserId).update({
      balance: firebase.firestore.FieldValue.increment(reward),
      totalEarned: firebase.firestore.FieldValue.increment(reward),
      joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
    });
    await payReferralCommission(reward);
    alert(`You earned ${reward} PEPE!`);
  } catch (err) {
    console.error("Verification failed:", err);
    alert("Error. Try again.");
    verifyBtn.disabled = false;
    verifyBtn.textContent = "Verify";
  }

  updateUI();
}

// --- [Task Button Setup] ---
function setupTaskListeners() {
  document.querySelectorAll(".task-card").forEach(card => {
    const taskId = card.dataset.taskId;
    const url = card.dataset.url;
    const reward = parseInt(card.dataset.reward);

    card.querySelector(".join-btn").addEventListener("click", () => {
      window.open(url, "_blank");
      card.querySelector(".verify-btn").disabled = false;
      card.querySelector(".join-btn").disabled = true;
      alert("After joining, come back and click Verify.");
    });

    card.querySelector(".verify-btn").addEventListener("click", () => {
      handleVerifyClick(taskId, reward);
    });
  });
}

// --- [Referral Modal] ---
window.openReferModal = function () {
  const refLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
  document.getElementById("referral-link").value = refLink;
  document.getElementById("refer-modal").style.display = "flex";
};

window.closeReferModal = function () {
  document.getElementById("refer-modal").style.display = "none";
};

window.copyReferralLink = function (btn) {
  const input = document.getElementById("referral-link");
  navigator.clipboard.writeText(input.value).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
  });
};

window.onclick = function (event) {
  if (event.target == document.getElementById("refer-modal")) {
    closeReferModal();
  }
};

// --- [Withdrawals] ---
function loadWithdrawalHistory() {
  const container = document.getElementById("history-list");
  db.collection("withdrawals").where("userId", "==", telegramUserId).orderBy("requestedAt", "desc").limit(10)
    .onSnapshot(snapshot => {
      container.innerHTML = "";
      if (snapshot.empty) {
        container.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
        return;
      }
      snapshot.forEach(doc => {
        const d = doc.data();
        const item = document.createElement("div");
        item.className = `history-item ${d.status}`;
        const date = d.requestedAt?.toDate?.() || new Date();
        item.innerHTML = `
          <div class="history-details">
            <div class="history-amount">${d.amount.toLocaleString()} PEPE</div>
            <div class="history-date">${date.toLocaleDateString()}</div>
          </div>
          <div class="history-status ${d.status}">${d.status}</div>
        `;
        container.appendChild(item);
      });
    });
}

window.submitWithdrawal = async function () {
  const amount = parseInt(document.getElementById("withdraw-amount").value);
  const method = document.getElementById("withdraw-method").value;
  const walletId = document.getElementById("wallet-id").value.trim();

  if (isNaN(amount) || !walletId || amount <= 0) return alert("Invalid input.");
  if (amount < WITHDRAWAL_MINIMUMS[method]) return alert(`Min: ${WITHDRAWAL_MINIMUMS[method]}`);
  if (amount > userState.balance) return alert("Insufficient balance.");

  try {
    await db.collection("withdrawals").add({
      userId: telegramUserId,
      username: userState.telegramUsername,
      amount,
      method: "Binance Pay",
      walletId,
      currency: "PEPE",
      status: "pending",
      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection("users").doc(telegramUserId).update({
      balance: firebase.firestore.FieldValue.increment(-amount)
    });

    alert("Withdrawal submitted.");
    document.getElementById("withdraw-amount").value = "";
    document.getElementById("wallet-id").value = "";
  } catch (err) {
    console.error(err);
    alert("Error submitting withdrawal.");
  }
};

// --- [Nav Control] ---
window.showTab = function (tab, el) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.getElementById(tab).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  el.classList.add("active");
};

// --- [App Entry Point] ---
function getTestUserId() {
  const id = localStorage.getItem("localAppUserId");
  if (id) return id;
  const newId = "test_" + Date.now();
  localStorage.setItem("localAppUserId", newId);
  return newId;
}

document.addEventListener("DOMContentLoaded", () => {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref) sessionStorage.setItem("referrerId", ref);
  const storedRef = sessionStorage.getItem("referrerId");

  if (window.Telegram && Telegram.WebApp) {
    Telegram.WebApp.ready();
    initializeApp(Telegram.WebApp.initDataUnsafe.user, storedRef);
  } else {
    console.warn("Not running in Telegram WebApp. Using test mode.");
    initializeApp(null, storedRef);
  }
});
