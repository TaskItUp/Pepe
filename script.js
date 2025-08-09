// -----------------------------
// script.js - FINAL FIXED VERSION
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

// --- LOCAL STORAGE HELPERS ---
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

// --- DB WRAPPER ---
const DB = {
  async init() {
    if (window.firebase && window.firebase.initializeApp) {
      try {
        if (!firebase.apps || firebase.apps.length === 0) {
          firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        useFirebase = true;
        console.log("Using Firebase Firestore");
      } catch (e) {
        console.warn("Firebase init failed, using local mode:", e);
        useFirebase = false;
        ensureLocalStores();
      }
    } else {
      console.warn("Firebase SDK missing — using localStorage fallback.");
      useFirebase = false;
      ensureLocalStores();
    }
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
    const u = lsGet('users', {}); u[userId] = data; lsSet('users', u);
  },
  async updateUserDoc(userId, updates) {
    if (useFirebase) return db.collection('users').doc(userId).update(updates);
    const users = lsGet('users', {}); const doc = users[userId] || {};
    Object.keys(updates).forEach(k => {
      const v = updates[k];
      if (v && v.__op === 'INCREMENT') doc[k] = (doc[k] || 0) + v.amount;
      else if (v && v.__op === 'ARRAY_UNION') {
        doc[k] = doc[k] || []; if (!doc[k].includes(v.value)) doc[k].push(v.value);
      } else doc[k] = v;
    });
    users[userId] = doc; lsSet('users', users);
  },
  LocalIncrement(amount) { return { __op: 'INCREMENT', amount }; },
  LocalArrayUnion(value) { return { __op: 'ARRAY_UNION', value }; },
  listenUserDoc(userId, onChange, onError) {
    if (useFirebase) {
      return db.collection('users').doc(userId).onSnapshot(doc => {
        onChange({ exists: doc.exists, data: doc.data ? doc.data() : null });
      }, onError);
    } else {
      (async () => { onChange(await this.getUserDoc(userId)); })();
      return () => {};
    }
  },
  listenWithdrawals(userId, onChange) {
    if (useFirebase) {
      return db.collection('withdrawals')
        .where('userId', '==', userId)
        .orderBy('requestedAt', 'desc')
        .limit(10)
        .onSnapshot(qs => {
          const items = []; qs.forEach(d => items.push(d.data())); onChange(items);
        });
    } else {
      (async () => {
        const list = lsGet('withdrawals', []);
        onChange(list.filter(i => i.userId === userId).slice(0, 10));
      })();
      return () => {};
    }
  },
  async addWithdrawal(record) {
    if (useFirebase) return db.collection('withdrawals').add(record);
    const list = lsGet('withdrawals', []); list.unshift(record); lsSet('withdrawals', list);
  }
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
function getReferrerIdFromContext(tgUser) {
  let refId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
  const params = new URLSearchParams(window.location.search);
  if (!refId && params.has('ref')) refId = params.get('ref');
  if (refId && tgUser && refId.toString() === tgUser.id.toString()) return null;
  return refId;
}

// --- Watch Ad ---
async function completeAdTask() {
  if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
    alert("You have completed all ad tasks for today!"); return;
  }
  const btn = $id('start-task-button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...'; }
  if (typeof window.show_9685198 === 'function') await window.show_9685198();
  else await new Promise(res => setTimeout(res, 1800));
  if (useFirebase) {
    await DB.updateUserDoc(telegramUserId, {
      balance: firebase.firestore.FieldValue.increment(AD_REWARD),
      totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
      tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
      totalAdsViewed: firebase.firestore.FieldValue.increment(1),
      lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    await DB.updateUserDoc(telegramUserId, {
      balance: DB.LocalIncrement(AD_REWARD),
      totalEarned: DB.LocalIncrement(AD_REWARD),
      tasksCompletedToday: DB.LocalIncrement(1),
      totalAdsViewed: DB.LocalIncrement(1),
      lastTaskTimestamp: new Date().toISOString()
    });
  }
  await payReferralCommission(AD_REWARD);
  alert(`+${AD_REWARD} PEPE earned!`);
  refreshUserDocAndUI();
}

// --- Referral commission ---
async function payReferralCommission(amount) {
  if (!userState || !userState.referredBy) return;
  const commission = Math.floor(amount * REFERRAL_COMMISSION_RATE);
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
}

// --- Withdrawals ---
async function submitWithdrawal() {
  const amount = parseInt($id('withdraw-amount').value) || 0;
  const method = $id('withdraw-method').value || 'binancepay';
  const walletId = $id('wallet-id').value.trim();
  if (amount < (WITHDRAWAL_MINIMUMS[method] || 0)) {
    alert("Minimum withdrawal not met."); return;
  }
  if (amount > (userState.balance || 0)) {
    alert("Not enough balance."); return;
  }
  await DB.addWithdrawal({
    userId: telegramUserId, username: userState.telegramUsername,
    amount, method, walletId, currency: "PEPE",
    status: "pending",
    requestedAt: useFirebase ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
  });
  if (useFirebase) {
    await DB.updateUserDoc(telegramUserId, { balance: firebase.firestore.FieldValue.increment(-amount) });
  } else {
    await DB.updateUserDoc(telegramUserId, { balance: DB.LocalIncrement(-amount) });
  }
  alert("Withdrawal request submitted.");
  refreshUserDocAndUI();
}

// --- UI ---
function updateUI() {
  if (!userState) return;
  if ($id('balance-home')) $id('balance-home').textContent = (userState.balance || 0).toLocaleString();
  if ($id('total-refers')) $id('total-refers').textContent = (userState.totalRefers || 0).toLocaleString();
}

// --- Main Init ---
async function initializeApp(tgUser) {
  await DB.init();
  telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
  DB.listenUserDoc(telegramUserId, async (doc) => {
    if (!doc.exists) {
      const referrerId = getReferrerIdFromContext(tgUser);
      const newUser = {
        username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || 'User' : 'User',
        telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : '@test_user',
        profilePicUrl: generatePlaceholderAvatar(telegramUserId),
        balance: 0, tasksCompletedToday: 0, totalEarned: 0, totalAdsViewed: 0,
        totalRefers: 0, joinedBonusTasks: [],
        referredBy: referrerId || null, referralEarnings: 0
      };
      if (referrerId && referrerId !== telegramUserId) {
        try {
          if (useFirebase) {
            await db.runTransaction(async (transaction) => {
              const refRef = db.collection('users').doc(referrerId);
              const refDoc = await transaction.get(refRef);
              if (!refDoc.exists) {
                transaction.set(refRef, {
                  username: "Referrer", telegramUsername: "@unknown",
                  profilePicUrl: generatePlaceholderAvatar(referrerId),
                  balance: 0, tasksCompletedToday: 0, totalEarned: 0, totalAdsViewed: 0,
                  totalRefers: 1, joinedBonusTasks: [],
                  referredBy: null, referralEarnings: 0
                });
              } else {
                transaction.update(refRef, { totalRefers: firebase.firestore.FieldValue.increment(1) });
              }
              transaction.set(db.collection('users').doc(telegramUserId), newUser);
            });
          } else {
            await DB.updateUserDoc(referrerId, { totalRefers: DB.LocalIncrement(1) });
            await DB.setUserDoc(telegramUserId, newUser);
          }
        } catch (e) {
          console.error("Referral transaction failed:", e);
          await DB.setUserDoc(telegramUserId, newUser);
        }
      } else {
        await DB.setUserDoc(telegramUserId, newUser);
      }
    } else {
      userState = doc.data || doc.data();
    }
    updateUI();
  });
}

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  if (window.Telegram && window.Telegram.WebApp) {
    Telegram.WebApp.ready();
    initializeApp(window.Telegram.WebApp.initDataUnsafe?.user || null);
  } else {
    initializeApp(null);
  }
  if ($id('start-task-button')) $id('start-task-button').addEventListener('click', completeAdTask);
  if ($id('submit-withdraw-btn')) $id('submit-withdraw-btn').addEventListener('click', submitWithdrawal);
});
