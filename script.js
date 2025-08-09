// -----------------------------
// script.js - FINAL MERGED VERSION
// -----------------------------

const firebaseConfig = {
  apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
  authDomain: "taskup-9ba7b.firebaseapp.com",
  projectId: "taskup-9ba7b",
  storageBucket: "taskup-9ba7b.appspot.com",
  messagingSenderId: "319481101196",
  appId: "1:319481101196:web:6cded5be97620d98d974a9",
  measurementId: "G-JNNLG1E49L"
};

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;

let useFirebase = false;
let db = null;
let userState = {};
let telegramUserId = null;

// --- DB Wrapper ---
const DB = {
  async init() {
    if (window.firebase && window.firebase.initializeApp) {
      try {
        if (!firebase.apps || firebase.apps.length === 0) {
          firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        useFirebase = true;
        console.log("✅ Using Firebase Firestore");
      } catch (e) {
        console.warn("⚠️ Firebase init failed:", e);
        useFirebase = false;
      }
    } else {
      console.warn("⚠️ Firebase SDK not loaded");
      useFirebase = false;
    }
  },
  async getUserDoc(userId) {
    if (useFirebase) {
      const doc = await db.collection('users').doc(userId).get();
      return { exists: doc.exists, data: doc.data() };
    }
    return { exists: false, data: null };
  },
  async setUserDoc(userId, data) {
    if (useFirebase) {
      return db.collection('users').doc(userId).set(data);
    }
  },
  async updateUserDoc(userId, updates) {
    if (useFirebase) {
      return db.collection('users').doc(userId).update(updates);
    }
  }
};

// --- Helpers ---
function generatePlaceholderAvatar(id) {
  return `https://i.pravatar.cc/150?u=${id}`;
}

function getReferrerId(tgUser) {
  let refId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
  const params = new URLSearchParams(window.location.search);
  if (!refId && params.has('ref')) {
    refId = params.get('ref');
  }
  if (refId && tgUser && refId.toString() === tgUser.id.toString()) {
    return null; // prevent self-referral
  }
  return refId;
}

// --- Watch Ad ---
async function completeAdTask() {
  if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
    alert("You have completed all ad tasks for today!");
    return;
  }
  if (typeof window.show_9685198 === 'function') {
    await window.show_9685198();
  } else {
    await new Promise(res => setTimeout(res, 2000)); // simulate
  }
  if (useFirebase) {
    await DB.updateUserDoc(telegramUserId, {
      balance: firebase.firestore.FieldValue.increment(AD_REWARD),
      totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
      tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
      totalAdsViewed: firebase.firestore.FieldValue.increment(1),
      lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  await payReferralCommission(AD_REWARD);
  alert(`+${AD_REWARD} PEPE earned!`);
}

// --- Referral Commission ---
async function payReferralCommission(amount) {
  if (!userState || !userState.referredBy) return;
  const commission = Math.floor(amount * REFERRAL_COMMISSION_RATE);
  if (commission <= 0) return;
  if (useFirebase) {
    await db.collection('users').doc(userState.referredBy).update({
      balance: firebase.firestore.FieldValue.increment(commission),
      referralEarnings: firebase.firestore.FieldValue.increment(commission)
    });
  }
}

// --- Initialize App ---
async function initializeApp(tgUser) {
  await DB.init();
  telegramUserId = tgUser ? tgUser.id.toString() : "test_user";

  const userDoc = await DB.getUserDoc(telegramUserId);
  if (!userDoc.exists) {
    const referrerId = getReferrerId(tgUser);
    console.log("📢 Detected referrerId:", referrerId);

    const newUser = {
      username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || 'User' : 'User',
      telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : '@test_user',
      profilePicUrl: generatePlaceholderAvatar(telegramUserId),
      balance: 0,
      tasksCompletedToday: 0,
      totalEarned: 0,
      totalAdsViewed: 0,
      totalRefers: 0,
      joinedBonusTasks: [],
      referredBy: referrerId || null,
      referralEarnings: 0
    };

    if (referrerId && referrerId !== telegramUserId) {
      try {
        if (useFirebase) {
          await db.runTransaction(async (transaction) => {
            const refRef = db.collection('users').doc(referrerId);
            const refDoc = await transaction.get(refRef);
            if (!refDoc.exists) {
              transaction.set(refRef, {
                username: "Referrer",
                telegramUsername: "@unknown",
                profilePicUrl: generatePlaceholderAvatar(referrerId),
                balance: 0,
                tasksCompletedToday: 0,
                totalEarned: 0,
                totalAdsViewed: 0,
                totalRefers: 1,
                joinedBonusTasks: [],
                referredBy: null,
                referralEarnings: 0
              });
            } else {
              transaction.update(refRef, {
                totalRefers: firebase.firestore.FieldValue.increment(1)
              });
            }
            transaction.set(db.collection('users').doc(telegramUserId), newUser);
          });
        }
      } catch (e) {
        console.error("Referral transaction failed:", e);
        await DB.setUserDoc(telegramUserId, newUser);
      }
    } else {
      await DB.setUserDoc(telegramUserId, newUser);
    }
  } else {
    userState = userDoc.data;
  }
}

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  if (window.Telegram && window.Telegram.WebApp) {
    Telegram.WebApp.ready();
    initializeApp(window.Telegram.WebApp.initDataUnsafe?.user || null);
  } else {
    initializeApp(null);
  }

  const adBtn = document.getElementById('start-task-button');
  if (adBtn) adBtn.addEventListener('click', completeAdTask);
});
