// --- [DATABASE & APP INITIALIZATION] ---
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

// --- [GLOBAL STATE] ---
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = {
  binancepay: 10000
};

// --- [INITIALIZE APP] ---
function initializeApp(tgUser, forcedReferrerId = null) {
  telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
  const userRef = db.collection('users').doc(telegramUserId);

  userRef.onSnapshot(async (doc) => {
    if (!doc.exists) {
      const referrerId = tgUser?.start_param || forcedReferrerId;

      const newUserState = {
        username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "User",
        telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`,
        profilePicUrl: generatePlaceholderAvatar(telegramUserId),
        balance: 0, tasksCompletedToday: 0, lastTaskTimestamp: null, totalEarned: 0,
        totalAdsViewed: 0, totalRefers: 0, joinedBonusTasks: [],
        referredBy: referrerId || null,
        referralEarnings: 0
      };

      if (referrerId) {
        const referrerRef = db.collection('users').doc(referrerId);
        try {
          await db.runTransaction(async (transaction) => {
            const refDoc = await transaction.get(referrerRef);
            if (!refDoc.exists) throw "Referrer not found!";
            transaction.update(referrerRef, {
              totalRefers: firebase.firestore.FieldValue.increment(1)
            });
            transaction.set(userRef, newUserState);
          });
        } catch (err) {
          console.error("Referral transaction failed:", err);
          await userRef.set(newUserState);
        }
      } else {
        await userRef.set(newUserState);
      }
    } else {
      userState = doc.data();
    }

    if (!isInitialized) {
      setupTaskButtonListeners();
      listenForWithdrawalHistory();
      isInitialized = true;
    }

    updateUI();
  });
}

// --- [UTILITIES] ---
function getFakeUserIdForTesting() {
  let storedId = localStorage.getItem('localAppUserId');
  if (storedId) return storedId;
  const newId = 'test_user_' + Date.now().toString(36);
  localStorage.setItem('localAppUserId', newId);
  return newId;
}

function generatePlaceholderAvatar(userId) {
  return `https://i.pravatar.cc/150?u=${userId}`;
}

// --- [UI UPDATES] ---
function updateUI() {
  const balance = Math.floor(userState.balance || 0).toLocaleString();
  const totalEarned = Math.floor(userState.totalEarned || 0).toLocaleString();
  const referralEarnings = (userState.referralEarnings || 0).toLocaleString();
  const totalRefers = (userState.totalRefers || 0).toLocaleString();

  document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
    if (userState.profilePicUrl) img.src = userState.profilePicUrl;
  });

  document.getElementById('balance-home').textContent = balance;
  document.getElementById('withdraw-balance').textContent = balance;
  document.getElementById('profile-balance').textContent = balance;
  document.getElementById('home-username').textContent = userState.username;
  document.getElementById('profile-name').textContent = userState.username;
  document.getElementById('telegram-username').textContent = userState.telegramUsername;

  document.getElementById('ads-watched-today').textContent = userState.tasksCompletedToday || 0;
  document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - (userState.tasksCompletedToday || 0);

  const completed = userState.tasksCompletedToday || 0;
  document.getElementById('tasks-completed').textContent = `${completed} / ${DAILY_TASK_LIMIT}`;
  document.getElementById('task-progress-bar').style.width = `${(completed / DAILY_TASK_LIMIT) * 100}%`;

  const taskBtn = document.getElementById('start-task-button');
  taskBtn.disabled = completed >= DAILY_TASK_LIMIT;
  taskBtn.innerHTML = completed >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';

  document.getElementById('earned-so-far').textContent = totalEarned;
  document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
  document.getElementById('total-refers').textContent = totalRefers;
  document.getElementById('refer-earnings').textContent = referralEarnings;
  document.getElementById('refer-count').textContent = totalRefers;

  const joinedTasks = userState.joinedBonusTasks || [];
  joinedTasks.forEach(taskId => {
    const taskCard = document.getElementById(`task-${taskId}`);
    if (taskCard) taskCard.classList.add('completed');
  });
}

async function payReferralCommission(earnedAmount) {
  if (!userState.referredBy) return;
  const commission = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
  if (commission <= 0) return;

  const referrerRef = db.collection('users').doc(userState.referredBy);
  try {
    await referrerRef.update({
      balance: firebase.firestore.FieldValue.increment(commission),
      referralEarnings: firebase.firestore.FieldValue.increment(commission)
    });
  } catch (err) {
    console.error("Referral commission failed:", err);
  }
}

function setupTaskButtonListeners() {
  document.querySelectorAll('.task-card').forEach(card => {
    const joinBtn = card.querySelector('.join-btn');
    const verifyBtn = card.querySelector('.verify-btn');
    const taskId = card.dataset.taskId;
    const url = card.dataset.url;
    const reward = parseInt(card.dataset.reward);

    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        handleJoinClick(taskId, url);
      });
    }

    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => {
        handleVerifyClick(taskId, reward);
      });
    }
  });
}

function handleJoinClick(taskId, url) {
  const card = document.getElementById(`task-${taskId}`);
  if (!card) return;

  const verifyBtn = card.querySelector('.verify-btn');
  const joinBtn = card.querySelector('.join-btn');

  window.open(url, '_blank');
  alert("After joining, return and press 'Verify' to claim your reward.");
  if (verifyBtn) verifyBtn.disabled = false;
  if (joinBtn) joinBtn.disabled = true;
}

async function handleVerifyClick(taskId, reward) {
  if (userState.joinedBonusTasks.includes(taskId)) {
    alert("You already completed this task.");
    return;
  }

  const taskCard = document.getElementById(`task-${taskId}`);
  const verifyBtn = taskCard.querySelector('.verify-btn');
  verifyBtn.disabled = true;
  verifyBtn.textContent = "Verifying...";

  try {
    const userRef = db.collection('users').doc(telegramUserId);
    await userRef.update({
      balance: firebase.firestore.FieldValue.increment(reward),
      totalEarned: firebase.firestore.FieldValue.increment(reward),
      joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
    });

    await payReferralCommission(reward);
    alert(`Success! You earned ${reward} PEPE.`);
  } catch (err) {
    console.error(err);
    alert("Verification failed. Try again.");
    verifyBtn.disabled = false;
    verifyBtn.textContent = "Verify";
  }
}

// --- [AD TASK LOGIC] ---
window.completeAdTask = async function () {
  if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
    alert("You’ve completed all ad tasks for today!");
    return;
  }

  const taskBtn = document.getElementById('start-task-button');
  try {
    taskBtn.disabled = true;
    taskBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';

    await window.show_9685198();

    const userRef = db.collection('users').doc(telegramUserId);
    await userRef.update({
      balance: firebase.firestore.FieldValue.increment(AD_REWARD),
      totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
      tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
      totalAdsViewed: firebase.firestore.FieldValue.increment(1),
      lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    await payReferralCommission(AD_REWARD);
    alert(`Success! ${AD_REWARD} PEPE credited.`);
  } catch (err) {
    console.error(err);
    alert("Ad failed or closed early. Try again.");
  } finally {
    updateUI();
  }
};

window.submitWithdrawal = async function () {
  const amount = parseInt(document.getElementById('withdraw-amount').value);
  const method = document.getElementById('withdraw-method').value;
  const walletId = document.getElementById('wallet-id').value.trim();
  const minAmount = WITHDRAWAL_MINIMUMS[method];

  if (isNaN(amount) || amount <= 0 || !walletId) {
    alert('Invalid withdrawal form.');
    return;
  }
  if (amount < minAmount) {
    alert(`Minimum withdrawal is ${minAmount.toLocaleString()} PEPE.`);
    return;
  }
  if (amount > userState.balance) {
    alert('Not enough balance.');
    return;
  }

  try {
    const historyList = document.getElementById('history-list');
    const optimisticData = {
      amount: amount,
      status: 'pending',
      requestedAt: new Date()
    };
    historyList.prepend(renderHistoryItem(optimisticData));

    await db.collection('withdrawals').add({
      userId: telegramUserId,
      username: userState.telegramUsername,
      amount: amount,
      method: "Binance Pay",
      walletId: walletId,
      currency: "PEPE",
      status: "pending",
      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const userRef = db.collection('users').doc(telegramUserId);
    await userRef.update({
      balance: firebase.firestore.FieldValue.increment(-amount)
    });

    alert(`Withdrawal request submitted: ${amount} PEPE`);
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('wallet-id').value = '';
  } catch (err) {
    console.error("Withdrawal error:", err);
    alert("Failed to submit withdrawal.");
  }
};

function renderHistoryItem(data) {
  const item = document.createElement('div');
  item.className = `history-item ${data.status}`;
  const date = data.requestedAt.toDate ? data.requestedAt.toDate() : data.requestedAt;
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  item.innerHTML = `<div class="history-details"><div class="history-amount">${data.amount.toLocaleString()} PEPE</div><div class="history-date">${formatted}</div></div><div class="history-status ${data.status}">${data.status}</div>`;
  return item;
}

function listenForWithdrawalHistory() {
  const historyList = document.getElementById('history-list');
  db.collection('withdrawals').where('userId', '==', telegramUserId).orderBy('requestedAt', 'desc').limit(10)
    .onSnapshot(snapshot => {
      historyList.innerHTML = '';
      if (snapshot.empty) {
        historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
      }
      snapshot.forEach(doc => {
        historyList.appendChild(renderHistoryItem(doc.data()));
      });
    });
}

// --- [REFERRAL MODAL + NAVIGATION] ---
window.showTab = function (tab, el) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(tab).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
};

window.openReferModal = function () {
  const link = `${window.location.origin}${window.location.pathname}?ref=${telegramUserId}`;
  document.getElementById('referral-link').value = link;
  document.getElementById('refer-modal').style.display = 'flex';
};

window.closeReferModal = function () {
  document.getElementById('refer-modal').style.display = 'none';
};

window.copyReferralLink = function (btn) {
  const input = document.getElementById('referral-link');
  navigator.clipboard.writeText(input.value).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => {
      btn.innerHTML = original;
    }, 1500);
  });
};

window.onclick = function (e) {
  if (e.target == document.getElementById('refer-modal')) {
    closeReferModal();
  }
};

// --- [APP ENTRY] ---
document.addEventListener('DOMContentLoaded', () => {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) sessionStorage.setItem('referrerId', ref);
  const storedRef = sessionStorage.getItem('referrerId');

  if (window.Telegram && window.Telegram.WebApp) {
    Telegram.WebApp.ready();
    initializeApp(window.Telegram.WebApp.initDataUnsafe.user, storedRef);
  } else {
    initializeApp(null, storedRef);
  }
});
