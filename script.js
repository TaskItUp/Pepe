<script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
// --- [FIREBASE CONFIG] ---
const firebaseConfig = {
    apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
    authDomain: "taskup-9ba7b.firebaseapp.com",
    projectId: "taskup-9ba7b",
    storageBucket: "taskup-9ba7b.appspot.com",
    messagingSenderId: "319481101196",
    appId: "1:319481101196:web:6cded5be97620d98d974a9",
    measurementId: "G-JNNLG1E49L"
};

// Initialize Firebase once
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// --- [GLOBAL STATE] ---
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- [TELEGRAM INIT] ---
document.addEventListener("DOMContentLoaded", () => {
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.ready();
        Telegram.WebApp.expand(); // make sure it takes full screen

        const initDataUnsafe = Telegram.WebApp.initDataUnsafe || {};
        console.log("Telegram init data:", initDataUnsafe);

        const tgUser = initDataUnsafe.user || null;
        const startParamId = initDataUnsafe.start_param ? String(initDataUnsafe.start_param) : null;

        initializeApp(tgUser, startParamId);
    } else {
        console.warn("Telegram WebApp not detected. Running in test mode.");
        initializeApp(null, null);
    }
});

// --- [APP INITIALIZATION] ---
function initializeApp(tgUser, startParamId) {
    telegramUserId = tgUser ? String(tgUser.id) : getFakeUserIdForTesting();
    console.log(`Initializing app for User ID: ${telegramUserId}`);

    const userRef = db.collection("users").doc(telegramUserId);

    const urlRefId = new URLSearchParams(window.location.search).get("ref");
    const referrerId = startParamId || urlRefId || null;

    // Real-time Firestore listener
    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log("New user detected. Creating account...");

            const newUserState = {
                username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ""}`.trim() : "User",
                telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : "@test_user",
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

            if (referrerId) {
                const referrerRef = db.collection("users").doc(referrerId);
                try {
                    await db.runTransaction(async (transaction) => {
                        const referrerDoc = await transaction.get(referrerRef);
                        if (!referrerDoc.exists) {
                            console.warn("Referrer not found.");
                            transaction.set(userRef, newUserState);
                            return;
                        }
                        transaction.update(referrerRef, {
                            totalRefers: firebase.firestore.FieldValue.increment(1)
                        });
                        transaction.set(userRef, newUserState);
                    });
                } catch (err) {
                    console.error("Referral transaction failed", err);
                    await userRef.set(newUserState);
                }
            } else {
                await userRef.set(newUserState);
            }
        } else {
            userState = doc.data();
            console.log("User data updated:", userState);
        }

        if (!isInitialized) {
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            isInitialized = true;
        }

        updateUI();
    }, (error) => console.error("Error listening to user document:", error));
}

// --- [HELPERS] ---
function getFakeUserIdForTesting() {
    let storedId = localStorage.getItem("localAppUserId");
    if (storedId) return storedId;
    const newId = "test_user_" + Date.now().toString(36);
    localStorage.setItem("localAppUserId", newId);
    return newId;
}

function generatePlaceholderAvatar(userId) {
    return `https://i.pravatar.cc/150?u=${userId}`;
}

// --- [UI UPDATE] ---
function updateUI() {
    const balance = Math.floor(userState.balance || 0).toLocaleString();
    const totalEarned = Math.floor(userState.totalEarned || 0).toLocaleString();
    const referralEarnings = (userState.referralEarnings || 0).toLocaleString();
    const totalRefers = (userState.totalRefers || 0).toLocaleString();
    const tasksCompleted = userState.tasksCompletedToday || 0;

    document.querySelectorAll(".profile-pic, .profile-pic-large").forEach(img => {
        if (userState.profilePicUrl) img.src = userState.profilePicUrl;
    });

    document.getElementById("balance-home").textContent = balance;
    document.getElementById("withdraw-balance").textContent = balance;
    document.getElementById("profile-balance").textContent = balance;
    document.getElementById("home-username").textContent = userState.username;
    document.getElementById("profile-name").textContent = userState.username;
    document.getElementById("telegram-username").textContent = userState.telegramUsername;
    document.getElementById("ads-watched-today").textContent = tasksCompleted;
    document.getElementById("ads-left-today").textContent = DAILY_TASK_LIMIT - tasksCompleted;
    document.getElementById("tasks-completed").textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    document.getElementById("task-progress-bar").style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;

    const taskButton = document.getElementById("start-task-button");
    taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT
        ? '<i class="fas fa-check-circle"></i> All tasks done'
        : '<i class="fas fa-play-circle"></i> Watch Ad';

    document.getElementById("earned-so-far").textContent = totalEarned;
    document.getElementById("total-ads-viewed").textContent = userState.totalAdsViewed || 0;
    document.getElementById("total-refers").textContent = totalRefers;
    document.getElementById("refer-earnings").textContent = referralEarnings;
    document.getElementById("refer-count").textContent = totalRefers;

    const joinedTasks = userState.joinedBonusTasks || [];
    joinedTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add("completed");
    });
}

function setupTaskButtonListeners() {
    // Your button click logic here
}
function listenForWithdrawalHistory() {
    // Your withdrawal history listener here
}
</script>
