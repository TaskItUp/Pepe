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
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- [APP INITIALIZATION] ---
function initializeApp(tgUser) {
    telegramUserId = tgUser?.id?.toString() || getFakeUserIdForTesting();
    console.log(`Initializing app for User ID: ${telegramUserId}`);

    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('New user detected.');

            const referrerId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;

            const newUserState = {
                username: tgUser?.first_name ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "User",
                telegramUsername: tgUser?.username ? `@${tgUser.username}` : `@guest_${telegramUserId}`,
                profilePicUrl: generatePlaceholderAvatar(telegramUserId),
                balance: 0, tasksCompletedToday: 0, lastTaskTimestamp: null,
                totalEarned: 0, totalAdsViewed: 0,
                totalRefers: 0,
                joinedBonusTasks: [],
                referredBy: referrerId && referrerId !== telegramUserId ? referrerId : null,
                referralEarnings: 0
            };

            userState = newUserState;

            if (referrerId && referrerId !== telegramUserId) {
                const referrerRef = db.collection('users').doc(referrerId);
                try {
                    await db.runTransaction(async (transaction) => {
                        const refDoc = await transaction.get(referrerRef);
                        if (refDoc.exists) {
                            transaction.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1)
                            });
                        }
                        transaction.set(userRef, newUserState);
                    });
                } catch (err) {
                    console.error("Referral transaction failed:", err);
                    newUserState.referredBy = null;
                    await userRef.set(newUserState);
                }
            } else {
                await userRef.set(newUserState);
            }
        } else {
            // ✅ If Telegram gives us data, update Firestore username if it's "User"
            userState = doc.data();
            if (tgUser?.first_name && userState.username === "User") {
                await userRef.update({
                    username: `${tgUser.first_name} ${tgUser.last_name || ''}`.trim(),
                    telegramUsername: tgUser.username ? `@${tgUser.username}` : userState.telegramUsername
                });
                userState.username = `${tgUser.first_name} ${tgUser.last_name || ''}`.trim();
            }
        }

        if (!isInitialized) {
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            setupNavigationBar(); // ✅ Fix navbar here
            isInitialized = true;
        }
        updateUI();
    });
}

// --- [HELPERS] ---
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

// --- [NAVIGATION BAR FIX + SLIDE EFFECT] ---
function setupNavigationBar() {
    const tabs = document.querySelectorAll('.tab-content');
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.getAttribute('data-target');
            if (!targetId) return;

            const activeTab = document.querySelector('.tab-content.active');
            const nextTab = document.getElementById(targetId);

            if (activeTab && nextTab && activeTab !== nextTab) {
                activeTab.classList.add('slide-out-left');
                nextTab.classList.add('slide-in-right', 'active');

                setTimeout(() => {
                    activeTab.classList.remove('active', 'slide-out-left');
                    nextTab.classList.remove('slide-in-right');
                }, 300);
            }

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

// Add CSS for slide animation
const style = document.createElement('style');
style.innerHTML = `
.tab-content { transition: transform 0.3s ease, opacity 0.3s ease; }
.slide-in-right { transform: translateX(100%); opacity: 0; animation: slideIn 0.3s forwards; }
.slide-out-left { animation: slideOut 0.3s forwards; }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(-100%); opacity: 0; } }
`;
document.head.appendChild(style);

// --- [UI UPDATE] ---
function updateUI() {
    if (!userState) return;

    const balanceString = Math.floor(userState.balance || 0).toLocaleString();
    const totalEarnedString = Math.floor(userState.totalEarned || 0).toLocaleString();
    const referralEarningsString = (userState.referralEarnings || 0).toLocaleString();
    const totalRefersString = (userState.totalRefers || 0).toLocaleString();

    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
        if (userState.profilePicUrl) img.src = userState.profilePicUrl;
    });
    document.getElementById('balance-home').textContent = balanceString;
    document.getElementById('withdraw-balance').textContent = balanceString;
    document.getElementById('profile-balance').textContent = balanceString;

    // ✅ Now always show correct name
    document.getElementById('home-username').textContent = userState.username || "User";
    document.getElementById('profile-name').textContent = userState.username || "User";

    document.getElementById('telegram-username').textContent = userState.telegramUsername;
    document.getElementById('ads-watched-today').textContent = userState.tasksCompletedToday || 0;
    document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - (userState.tasksCompletedToday || 0);
    const tasksCompleted = userState.tasksCompletedToday || 0;
    document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;
    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT
        ? '<i class="fas fa-check-circle"></i> All tasks done'
        : '<i class="fas fa-play-circle"></i> Watch Ad';
    document.getElementById('earned-so-far').textContent = totalEarnedString;
    document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
    document.getElementById('total-refers').textContent = totalRefersString;
    document.getElementById('refer-earnings').textContent = referralEarningsString;
    document.getElementById('refer-count').textContent = totalRefersString;
}

// --- [REST OF YOUR FUNCTIONS stay the same as before] ---
