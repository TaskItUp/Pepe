<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js"></script>

<!-- Telegram WebApp -->
<script src="https://telegram.org/js/telegram-web-app.js"></script>

<script>
document.addEventListener("DOMContentLoaded", () => {
    initTelegramApp();
});

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
    authDomain: "taskup-9ba7b.firebaseapp.com",
    projectId: "taskup-9ba7b",
    storageBucket: "taskup-9ba7b.appspot.com",
    messagingSenderId: "319481101196",
    appId: "1:319481101196:web:6cded5be97620d98d974a9",
    measurementId: "G-JNNLG1E49L"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- GLOBAL VARIABLES ---
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;

// --- INIT TELEGRAM APP ---
function initTelegramApp() {
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.ready();

        const tgUser = Telegram.WebApp.initDataUnsafe?.user || null;
        const startParamId = Telegram.WebApp.initDataUnsafe?.start_param || null;

        console.log("Telegram User:", tgUser);
        initializeApp(tgUser, startParamId);
    } else {
        console.warn("Running in test mode (no Telegram detected)");
        initializeApp(null, null);
    }
}

// --- INITIALIZE APP ---
function initializeApp(tgUser, startParamId) {
    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();

    console.log(`Initializing for User ID: ${telegramUserId}`);
    const userRef = db.collection('users').doc(telegramUserId);
    const urlRefId = new URLSearchParams(window.location.search).get('ref');
    const referrerId = startParamId || urlRefId || null;

    // Listen for user changes
    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            await createNewUser(userRef, tgUser, referrerId);
        } else {
            userState = doc.data();
        }

        if (!isInitialized) {
            setupTaskButtonListeners();
            isInitialized = true;
        }
        updateUI();
    }, (error) => {
        console.error("Snapshot error:", error);
    });
}

// --- CREATE NEW USER ---
async function createNewUser(userRef, tgUser, referrerId) {
    const newUserState = {
        username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "User",
        telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`,
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

    if (referrerId) {
        try {
            const referrerRef = db.collection('users').doc(referrerId);
            await db.runTransaction(async (transaction) => {
                const referrerDoc = await transaction.get(referrerRef);
                if (referrerDoc.exists) {
                    transaction.update(referrerRef, {
                        totalRefers: firebase.firestore.FieldValue.increment(1)
                    });
                }
                transaction.set(userRef, newUserState);
            });
        } catch (error) {
            console.error("Referral transaction failed:", error);
            await userRef.set(newUserState);
        }
    } else {
        await userRef.set(newUserState);
    }
}

// --- HELPERS ---
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

// --- UI UPDATE ---
function updateUI() {
    if (!document.getElementById('balance-home')) return; // Prevent errors if elements aren't ready

    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
        img.src = userState.profilePicUrl || generatePlaceholderAvatar(telegramUserId);
    });

    const tasksCompleted = userState.tasksCompletedToday || 0;
    const balance = Math.floor(userState.balance || 0).toLocaleString();

    document.getElementById('balance-home').textContent = balance;
    document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - tasksCompleted;

    document.getElementById('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;

    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT
        ? '<i class="fas fa-check-circle"></i> All tasks done'
        : '<i class="fas fa-play-circle"></i> Watch Ad';
}

// --- BUTTON LISTENERS ---
function setupTaskButtonListeners() {
    const taskBtn = document.getElementById('start-task-button');
    if (!taskBtn) return;
    taskBtn.addEventListener('click', () => {
        console.log("Ad watched, crediting user...");
        db.collection('users').doc(telegramUserId).update({
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD)
        });
    });
}
</script>
