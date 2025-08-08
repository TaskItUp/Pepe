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
async function startApp(tgUser, referrerId = null) {
  userId = tgUser ? tgUser.id.toString() : getTestUserId();
  const userRef = db.collection("users").doc(userId);
  const refId = referrerId || getReferrerId();

  const doc = await userRef.get();

  if (!doc.exists) {
    const newUser = {
      username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "Test User",
      telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : "test_user",
      profilePicUrl: `https://i.pravatar.cc/150?u=${userId}`,
      balance: 0,
      totalEarned: 0,
      referralEarnings: 0,
      totalRefers: 0,
      tasksCompletedToday: 0,
      totalAdsViewed: 0,
      joinedBonusTasks: [],
      referredBy: refId || null
    };

    if (refId) {
      const refUserRef = db.collection("users").doc(refId);
      await db.runTransaction(async (tx) => {
        const refSnap = await tx.get(refUserRef);
        if (refSnap.exists) {
          tx.update(refUserRef, {
            totalRefers: firebase.firestore.FieldValue.increment(1)
          });
        }
        tx.set(userRef, newUser);
      });
    } else {
      await userRef.set(newUser);
    }
  }

  // Start listening to user changes
  userRef.onSnapshot((doc) => {
    userData = doc.data();
    if (!initialized) {
      setupUI();
      setupTaskListeners();
      initialized = true;
    }
    updateUI();
  });
}
async function payReferrerCommission(amount) {
  if (!userData.referredBy) return;
  const commission = Math.floor(amount * COMMISSION_PERCENT / 100);
  const refUserRef = db.collection("users").doc(userData.referredBy);

  try {
    await refUserRef.update({
      balance: firebase.firestore.FieldValue.increment(commission),
      referralEarnings: firebase.firestore.FieldValue.increment(commission)
    });
  } catch (e) {
    console.error("Failed to pay referral commission:", e);
  }
}
async function handleBonusTaskComplete(taskId, reward) {
  if (userData.joinedBonusTasks.includes(taskId)) {
    alert("You already completed this task.");
    return;
  }

  const userRef = db.collection("users").doc(userId);
  await userRef.update({
    balance: firebase.firestore.FieldValue.increment(reward),
    totalEarned: firebase.firestore.FieldValue.increment(reward),
    joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
  });

  await payReferrerCommission(reward);
  alert(`You earned ${reward} PEPE!`);
}
async function completeAdTask() {
  if (userData.tasksCompletedToday >= DAILY_TASK_LIMIT) {
    alert("All daily tasks completed.");
    return;
  }

  // Simulate watching ad
  await window.show_9685198(); // Your Monetag ad call

  const userRef = db.collection("users").doc(userId);
  await userRef.update({
    balance: firebase.firestore.FieldValue.increment(AD_REWARD),
    totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
    tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
    totalAdsViewed: firebase.firestore.FieldValue.increment(1),
    lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
  });

  await payReferrerCommission(AD_REWARD);
  alert(`You earned ${AD_REWARD} PEPE!`);
}
function openReferralModal() {
  const link = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${userId}`;
  document.getElementById("referral-link").value = link;
  document.getElementById("refer-modal").style.display = "flex";
}

function copyReferralLink(btn) {
  const input = document.getElementById("referral-link");
  navigator.clipboard.writeText(input.value).then(() => {
    btn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => btn.innerHTML = 'Copy', 1500);
  });
}

