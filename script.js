// -----------------------------
// script.js - Final fixed file
// -----------------------------

// --- CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
  authDomain: "taskup-9ba7b.firebaseapp.com",
  projectId: "taskup-9ba7b",
  storageBucket: "taskup-9ba7b.appspot.com",
  messagingSenderId: "319481101196",
  appId: "1:319481101196:web:6cded5be97620d98d974a9",
  measurementId: "G-JNNLG1E49L"
};

const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- STATE ---
let useFirebase = false;
let db = null;
let userState = {};
let telegramUserId = null;
let isInitialized = false;

// --- LOCAL STORAGE FALLBACK HELPERS ---
const LS_PREFIX = 'taskapp_v1_';
function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("lsGet error:", e);
    return fallback;
  }
}
function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); }
  catch (e) { console.error("lsSet error:", e); }
}
function ensureLocalStores() {
  if (lsGet('users', null) === null) lsSet('users', {});
  if (lsGet('withdrawals', null) === null) lsSet('withdrawals', []);
}

// --- DB WRAPPER (Firebase or Local) ---
const DB = {
  async init() {
    try {
      if (window.firebase && window.firebase.initializeApp) {
        try {
          if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp(firebaseConfig);
          }
          db = firebase.firestore();
          useFirebase = true;
          console.log("Using Firebase Firestore");
        } catch (e) {
          console.warn("Firebase init failed, falling back to local:", e);
          useFirebase = false;
          ensureLocalStores();
        }
      } else {
        console.warn("Firebase SDK missing — using localStorage fallback.");
        useFirebase = false;
        ensureLocalStores();
      }
    } catch (err) {
      console.error("DB.init error:", err);
      useFirebase = false;
      ensureLocalStores();
    }
  },

  // Transaction: unified interface. For local, emulate minimal transaction behavior.
  async runTransaction(fn) {
    if (useFirebase) return db.runTransaction(fn);
    // local transaction: provide get/set/update
    ensureLocalStores();
    const users = lsGet('users', {});
    const tx = {
      get: async (ref) => {
        const id = ref._id;
        return { exists: !!users[id], data: () => users[id] || null };
      },
      set: async (ref, data) => {
        const id = ref._id;
        users[id] = data;
      },
      update: async (ref, updates) => {
        const id = ref._id;
        const doc = users[id] || {};
        Object.keys(updates).forEach(k => {
          const v = updates[k];
          // increment marker
          if (v && v.__op === 'INCREMENT') {
            doc[k] = (doc[k] || 0) + v.amount;
          } else if (v && v.__op === 'ARRAY_UNION') {
            doc[k] = doc[k] || [];
            if (!doc[k].includes(v.value)) doc[k].push(v.value);
          } else {
            doc[k] = v;
          }
        });
        users[id] = doc;
      }
    };
    await fn(tx);
    lsSet('users', users);
  },

  collectionRef(collectionName, id = null) {
    return { _collection: collectionName, _id: id };
  },

  async getUserDoc(userId) {
    if (useFirebase) {
      const d = await db.collection('users').doc(userId).get();
      return { exists: d.exists, data: d.data ? d.data() : null };
    } else {
      ensureLocalStores();
      const u = lsGet('users', {});
      return { exists: !!u[userId], data: u[userId] || null };
    }
  },

  async setUserDoc(userId, data) {
    if (useFirebase) return db.collection('users').doc(userId).set(data);
    ensureLocalStores();
    const u = lsGet('users', {});
    u[userId] = data;
    lsSet('users', u);
  },

  async updateUserDoc(userId, updates) {
    if (useFirebase) return db.collection('users').doc(userId).update(updates);
    ensureLocalStores();
    const users = lsGet('users', {});
    const doc = users[userId] || {};
    Object.keys(updates).forEach(k => {
      const v = updates[k];
      if (v && v.__op === 'INCREMENT') doc[k] = (doc[k] || 0) + v.amount;
      else if (v && v.__op === 'ARRAY_UNION') {
        doc[k] = doc[k] || [];
        if (!doc[k].includes(v.value)) doc[k].push(v.value);
      } else doc[k] = v;
    });
    users[userId] = doc;
    lsSet('users', users);
  },

  async addWithdrawal(record) {
    if (useFirebase) return db.collection('withdrawals').add(record);
    ensureLocalStores();
    const list = lsGet('withdrawals', []);
    list.unshift(Object.assign({}, record, { _localId: Date.now() }));
    lsSet('withdrawals', list);
  },

  listenUserDoc(userId, onChange, onError) {
    if (useFirebase) {
      return db.collection('users').doc(userId).onSnapshot(doc => {
        onChange({ exists: doc.exists, data: doc.data ? doc.data() : null });
      }, onError);
    } else {
      (async () => {
        const doc = await this.getUserDoc(userId);
        onChange(doc);
      })();
      return () => {};
    }
  },

  listenWithdrawals(userId, onChange, onError) {
    if (useFirebase) {
      return db.collection('withdrawals')
        .where('userId', '==', userId)
        .orderBy('requestedAt', 'desc')
        .limit(10)
        .onSnapshot(qs => {
          if (qs.empty) onChange([]);
          else {
            const items = [];
            qs.forEach(d => items.push(d.data()));
            onChange(items);
          }
        }, onError);
    } else {
      (async () => {
        const list = lsGet('withdrawals', []);
        const filtered = list.filter(i => i.userId === userId).slice(0, 10);
        onChange(filtered);
      })();
      return () => {};
    }
  },

  LocalIncrement(amount) { return { __op: 'INCREMENT', amount }; },
  LocalArrayUnion(value) { return { __op: 'ARRAY_UNION', value }; }
};

// --- UTILITIES ---
function $id(id) { return document.getElementById(id); }
function generatePlaceholderAvatar(id) { return `https://i.pravatar.cc/150?u=${id}`; }
function getFakeUserIdForTesting() {
  let sid = localStorage.getItem('localAppUserId');
  if (sid) return sid;
  const newId = 'test_user_' + Date.now().toString(36);
  localStorage.setItem('localAppUserId', newId);
  return newId;
}

// Read referral from Telegram start_param or URL ?ref= fallback
function getReferrerIdFromContext(tgUser) {
  let refId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
  const params = new URLSearchParams(window.location.search);
  if (!refId && params.has('ref')) refId = params.get('ref');
  if (refId && tgUser && refId.toString() === tgUser.id.toString()) return null; // prevent self-referral
  return refId;
}

// --- UI Rendering helpers ---
function renderHistoryItem(withdrawalData) {
  const item = document.createElement('div');
  item.className = `history-item ${withdrawalData.status || 'pending'}`;
  const date = withdrawalData.requestedAt && (withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : new Date(withdrawalData.requestedAt)) || new Date();
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  item.innerHTML = `
    <div class="history-details">
      <div class="history-amount">${(withdrawalData.amount || 0).toLocaleString()} PEPE</div>
      <div class="history-date">${formattedDate}</div>
    </div>
    <div class="history-status ${withdrawalData.status || 'pending'}">${withdrawalData.status || 'pending'}</div>
  `;
  return item;
}

// --- Attach UI listeners early so buttons respond immediately ---
function setupStaticListeners() {
  // Join/verify task buttons (delegate)
  document.querySelectorAll('.task-card').forEach(card => {
    const taskId = card.dataset.taskId;
    const url = card.dataset.url;
    const reward = parseInt(card.dataset.reward) || 0;
    const joinBtn = card.querySelector('.join-btn');
    const verifyBtn = card.querySelector('.verify-btn');

    if (joinBtn) joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
    if (verifyBtn) verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
  });

  // Watch ad
  const startBtn = $id('start-task-button');
  if (startBtn) startBtn.addEventListener('click', completeAdTask);

  // Withdraw submit
  const submitWithdrawBtn = $id('submit-withdraw-btn');
  if (submitWithdrawBtn) submitWithdrawBtn.addEventListener('click', submitWithdrawal);

  // Refer FAB + modal controls
  const referFab = $id('refer-fab');
  if (referFab) referFab.addEventListener('click', openReferModal);
  const closeRefer = $id('close-refer-modal');
  if (closeRefer) closeRefer.addEventListener('click', closeReferModal);

  // copy buttons inside modal and profile inline copy
  document.querySelectorAll('[onclick^="copyReferralLink"]').forEach(btn => {
    // these elements already have inline onclick but adding listener is fine
    btn.addEventListener('click', (e) => {
      const btnEl = e.currentTarget;
      // determine which input to copy - profile button passes a second param, but inline attr already uses it
      if (btnEl.getAttribute('onclick').includes('profile-referral-link')) {
        copyReferralLink(btnEl, 'profile-referral-link');
      } else {
        copyReferralLink(btnEl, 'referral-link');
      }
    });
  });

  // modal overlay click to close
  window.addEventListener('click', (ev) => {
    const modal = $id('refer-modal');
    if (modal && ev.target === modal) closeReferModal();
  });

  // Expose functions for inline onclick compatibility
  window.copyReferralLink = copyReferralLink;
  window.completeAdTask = completeAdTask;
  window.submitWithdrawal = submitWithdrawal;
  window.openReferModal = openReferModal;
  window.closeReferModal = closeReferModal;
  window.showTab = showTab;
}

// --- Task handlers ---
function handleJoinClick(taskId, url) {
  const taskCard = document.getElementById(`task-${taskId}`) || document.getElementById(`task-${taskId}`) || document.getElementById(`task-${taskId.replace(/^task-?/,'')}`) || document.getElementById(`task-${taskId}`);
  // Actually your HTML uses id="task-channel_1" and data-task-id="channel_1" — so the safe way:
  const fallbackCard = Array.from(document.querySelectorAll('.task-card')).find(c => c.dataset.taskId === taskId);
  const card = taskCard || fallbackCard;
  if (!card) return;
  const joinBtn = card.querySelector('.join-btn');
  const verifyBtn = card.querySelector('.verify-btn');

  if (url) window.open(url, '_blank');
  if (verifyBtn) verifyBtn.disabled = false;
  if (joinBtn) joinBtn.disabled = true;
  alert("After joining, return to the app and press 'Verify' to claim your reward.");
}

async function handleVerifyClick(taskId, reward) {
  try {
    if (!userState.joinedBonusTasks) userState.joinedBonusTasks = [];
    if (userState.joinedBonusTasks.includes(taskId)) {
      alert("You have already completed this task.");
      return;
    }

    const card = Array.from(document.querySelectorAll('.task-card')).find(c => c.dataset.taskId === taskId);
    const verifyBtn = card ? card.querySelector('.verify-btn') : null;
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Verifying...";
    }

    const uid = telegramUserId;
    if (!uid) throw new Error("Missing user id");

    if (useFirebase) {
      await DB.updateUserDoc(uid, {
        balance: firebase.firestore.FieldValue.increment(reward),
        totalEarned: firebase.firestore.FieldValue.increment(reward),
        joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
      });
    } else {
      await DB.updateUserDoc(uid, {
        balance: DB.LocalIncrement(reward),
        totalEarned: DB.LocalIncrement(reward),
        joinedBonusTasks: DB.LocalArrayUnion(taskId)
      });
    }

    await payReferralCommission(reward);
    alert(`Verification successful! You've earned ${reward} PEPE.`);
  } catch (err) {
    console.error("handleVerifyClick error:", err);
    alert("An error occurred during verification. Try again.");
  } finally {
    refreshUserDocAndUI();
  }
}

// --- Ad Task ---
async function completeAdTask() {
  try {
    if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
      alert("You have completed all ad tasks for today!");
      return;
    }

    const btn = $id('start-task-button');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
    }

    // If real SDK available, use it. Otherwise simulate.
    if (typeof window.show_9685198 === 'function') {
      try { await window.show_9685198(); } catch (e) { console.warn("Ad SDK call failed:", e); }
    } else {
      // simulate ad
      await new Promise(res => setTimeout(res, 1800));
    }

    const uid = telegramUserId;
    if (!uid) throw new Error("No user id");

    if (useFirebase) {
      await DB.updateUserDoc(uid, {
        balance: firebase.firestore.FieldValue.increment(AD_REWARD),
        totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
        tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
        totalAdsViewed: firebase.firestore.FieldValue.increment(1),
        lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await DB.updateUserDoc(uid, {
        balance: DB.LocalIncrement(AD_REWARD),
        totalEarned: DB.LocalIncrement(AD_REWARD),
        tasksCompletedToday: DB.LocalIncrement(1),
        totalAdsViewed: DB.LocalIncrement(1),
        lastTaskTimestamp: new Date().toISOString()
      });
    }

    await payReferralCommission(AD_REWARD);
    alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
  } catch (err) {
    console.error("completeAdTask error:", err);
    alert("Ad failed or was interrupted. Try again.");
  } finally {
    refreshUserDocAndUI();
  }
}

// --- Referral commission ---
async function payReferralCommission(earnedAmount) {
  try {
    if (!userState || !userState.referredBy) return;
    const commission = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
    if (commission <= 0) return;
    const refId = userState.referredBy;
    if (useFirebase) {
      await db.collection('users').doc(refId).update({
        balance: firebase.firestore.FieldValue.increment(commission),
        referralEarnings: firebase.firestore.FieldValue.increment(commission)
      });
    } else {
      await DB.updateUserDoc(refId, {
        balance: DB.LocalIncrement(commission),
        referralEarnings: DB.LocalIncrement(commission)
      });
    }
  } catch (e) { console.error("payReferralCommission error:", e); }
}

// --- Withdrawals ---
async function submitWithdrawal() {
  try {
    const amount = parseInt(($id('withdraw-amount') && $id('withdraw-amount').value) || 0);
    const method = ($id('withdraw-method') && $id('withdraw-method').value) || 'binancepay';
    const walletId = ($id('wallet-id') && $id('wallet-id').value || '').trim();
    const min = WITHDRAWAL_MINIMUMS[method] || 0;

    if (!amount || amount <= 0 || !walletId) {
      alert('Please enter a valid amount and your Binance ID or Email.');
      return;
    }
    if (amount < min) {
      alert(`Withdrawal failed. Minimum is ${min.toLocaleString()} PEPE.`);
      return;
    }
    if (amount > (userState.balance || 0)) {
      alert('Withdrawal failed. Not enough balance.');
      return;
    }

    const optimistic = { userId: telegramUserId, amount: amount, status: 'pending', requestedAt: new Date() };
    const historyList = $id('history-list');
    if (historyList) {
      const noMsg = historyList.querySelector('.no-history');
      if (noMsg) noMsg.remove();
      historyList.prepend(renderHistoryItem(optimistic));
    }

    if (useFirebase) {
      await DB.addWithdrawal({
        userId: telegramUserId,
        username: userState.telegramUsername || '@unknown',
        amount,
        method: "Binance Pay",
        walletId,
        currency: "PEPE",
        status: "pending",
        requestedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await DB.updateUserDoc(telegramUserId, { balance: firebase.firestore.FieldValue.increment(-amount) });
    } else {
      await DB.addWithdrawal({
        userId: telegramUserId,
        username: userState.telegramUsername || '@unknown',
        amount,
        method: "Binance Pay",
        walletId,
        currency: "PEPE",
        status: "pending",
        requestedAt: new Date().toISOString()
      });
      await DB.updateUserDoc(telegramUserId, { balance: DB.LocalIncrement(-amount) });
    }

    alert(`Success! Withdrawal request for ${amount.toLocaleString()} PEPE submitted.`);
    if ($id('withdraw-amount')) $id('withdraw-amount').value = '';
    if ($id('wallet-id')) $id('wallet-id').value = '';
  } catch (err) {
    console.error("submitWithdrawal error:", err);
    alert("There was an error submitting your request. Please try again.");
  } finally {
    refreshUserDocAndUI();
  }
}

function listenForWithdrawalHistory() {
  DB.listenWithdrawals(telegramUserId, (items) => {
    const historyList = $id('history-list');
    if (!historyList) return;
    if (!items || items.length === 0) {
      historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
      return;
    }
    historyList.innerHTML = '';
    items.forEach(i => historyList.appendChild(renderHistoryItem(i)));
  }, (e) => console.error("listenForWithdrawalHistory error:", e));
}

// --- Referral modal & copy ---
function openReferModal() {
  if (!TELEGRAM_BOT_USERNAME) { alert("Error: Bot username not set."); return; }
  const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
  const input = $id('referral-link');
  if (input) input.value = referralLink;
  const modal = $id('refer-modal');
  if (modal) modal.style.display = 'flex';
}

function closeReferModal() {
  const modal = $id('refer-modal'); if (modal) modal.style.display = 'none';
}

function copyReferralLink(button, inputId = 'referral-link') {
  const linkInput = $id(inputId);
  if (!linkInput) { alert("Referral input not found."); return; }
  const text = linkInput.value;
  navigator.clipboard?.writeText(text).then(() => {
    if (button) {
      const original = button.innerHTML;
      button.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => button.innerHTML = original, 1500);
    } else {
      alert("Referral link copied!");
    }
  }).catch(err => {
    console.warn("Clipboard failed:", err);
    prompt("Copy this link:", text);
  });
}

// --- Tabs ---
function showTab(tabName, element) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const el = document.getElementById(tabName);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (element) element.classList.add('active');
}

// --- UI Update ---
function updateUI() {
  if (!userState) return;
  const balance = Math.floor(userState.balance || 0).toLocaleString();
  const totalEarned = Math.floor(userState.totalEarned || 0).toLocaleString();
  const referralEarnings = (userState.referralEarnings || 0).toLocaleString();
  const totalRefers = (userState.totalRefers || 0).toLocaleString();

  document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
    if (userState.profilePicUrl) img.src = userState.profilePicUrl;
  });

  if ($id('balance-home')) $id('balance-home').textContent = balance;
  if ($id('withdraw-balance')) $id('withdraw-balance').textContent = balance;
  if ($id('profile-balance')) $id('profile-balance').textContent = balance;
  if ($id('home-username')) $id('home-username').textContent = userState.username || 'User';
  if ($id('profile-name')) $id('profile-name').textContent = userState.username || 'User';
  if ($id('telegram-username')) $id('telegram-username').textContent = userState.telegramUsername || '@unknown';
  if ($id('ads-watched-today')) $id('ads-watched-today').textContent = userState.tasksCompletedToday || 0;
  if ($id('ads-left-today')) $id('ads-left-today').textContent = DAILY_TASK_LIMIT - (userState.tasksCompletedToday || 0);

  const tasksCompleted = userState.tasksCompletedToday || 0;
  if ($id('tasks-completed')) $id('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
  if ($id('task-progress-bar')) $id('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;

  const startBtn = $id('start-task-button');
  if (startBtn) {
    startBtn.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    startBtn.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';
  }

  if ($id('earned-so-far')) $id('earned-so-far').textContent = totalEarned;
  if ($id('total-ads-viewed')) $id('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
  if ($id('total-refers')) $id('total-refers').textContent = totalRefers;
  if ($id('refer-earnings')) $id('refer-earnings').textContent = referralEarnings;
  if ($id('refer-count')) $id('refer-count').textContent = totalRefers;

  // mark joined tasks
  const joined = userState.joinedBonusTasks || [];
  joined.forEach(tid => {
    const card = Array.from(document.querySelectorAll('.task-card')).find(c => c.dataset.taskId === tid || c.id === `task-${tid}` || c.id === `task_${tid}` || c.id === tid || c.id === `task-${tid}`);
    if (card) card.classList.add('completed');
  });

  // referral links
  const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
  if ($id('referral-link')) $id('referral-link').value = referralLink;
  if ($id('profile-referral-link')) $id('profile-referral-link').value = referralLink;
}

// refresh user doc and UI
async function refreshUserDocAndUI() {
  try {
    const doc = await DB.getUserDoc(telegramUserId);
    if (doc && doc.exists) userState = doc.data || doc.data();
  } catch (e) { console.error("refreshUserDocAndUI error:", e); }
  updateUI();
}

// --- APP INIT: create user doc if missing, handle referral creation ---
async function initializeApp(tgUser) {
  await DB.init();
  ensureLocalStores();

  telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
  console.log("Initializing for user:", telegramUserId);

  if (!isInitialized) {
    setupStaticListeners();
    isInitialized = true;
  }

  // Listen or create user
  DB.listenUserDoc(telegramUserId, async (doc) => {
    try {
      if (!doc || !doc.exists) {
        console.log("New user - creating doc:", telegramUserId);
        const referrerId = getReferrerIdFromContext(tgUser);
        const newUser = {
          username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || 'User' : 'User',
          telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : '@test_user',
          profilePicUrl: generatePlaceholderAvatar(telegramUserId),
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

        if (referrerId && referrerId !== telegramUserId) {
          try {
            await DB.runTransaction(async (transaction) => {
              const refRef = DB.collectionRef('users', referrerId);
              const refDoc = await transaction.get(refRef);
              if (!refDoc.exists) {
                await transaction.set(refRef, {
                  username: "Referrer",
                  telegramUsername: "@unknown",
                  profilePicUrl: generatePlaceholderAvatar(referrerId),
                  balance: 0,
                  tasksCompletedToday: 0,
                  lastTaskTimestamp: null,
                  totalEarned: 0,
                  totalAdsViewed: 0,
                  totalRefers: 1,
                  joinedBonusTasks: [],
                  referredBy: null,
                  referralEarnings: 0
                });
              } else {
                // increment totalRefers
                if (useFirebase) {
                  await transaction.update(refRef, { totalRefers: firebase.firestore.FieldValue.increment(1) });
                } else {
                  await transaction.update(refRef, { totalRefers: DB.LocalIncrement(1) });
                }
              }
              const userRef = DB.collectionRef('users', telegramUserId);
              await transaction.set(userRef, newUser);
            });
          } catch (txErr) {
            console.error("Referral transaction failed - creating user without referral:", txErr);
            newUser.referredBy = null;
            await DB.setUserDoc(telegramUserId, newUser);
          }
        } else {
          await DB.setUserDoc(telegramUserId, newUser);
        }
      } else {
        userState = doc.data || doc.data();
      }
    } catch (e) {
      console.error("listenUserDoc handler error:", e);
    } finally {
      refreshUserDocAndUI();
      listenForWithdrawalHistory();
    }
  }, (err) => console.error("listenUserDoc error:", err));
}

// --- Start: DOM ready ---
document.addEventListener('DOMContentLoaded', () => {
  setupStaticListeners();
  // Telegram WebApp detection
  if (window.Telegram && window.Telegram.WebApp) {
    try { Telegram.WebApp.ready(); } catch (e) { console.warn("Telegram ready failed:", e); }
    const tgUser = window.Telegram.WebApp.initDataUnsafe?.user || null;
    initializeApp(tgUser);
  } else {
    console.warn("Telegram WebApp not found - running local mode.");
    initializeApp(null);
  }
});
