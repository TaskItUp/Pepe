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
function getReferrerId(tgUser) {
    // 1. Telegram start_param
    let refId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
    // 2. Local test via URL ?ref=xxxx
    const params = new URLSearchParams(window.location.search);
    if (!refId && params.has("ref")) {
        refId = params.get("ref");
    }
    // Avoid self-referral
    if (refId && tgUser && refId === tgUser.id.toString()) {
        return null;
    }
    return refId;
}

// --- [APP INITIALIZATION] ---
function initializeApp(tgUser) {
    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
    console.log(`Initializing app for User ID: ${telegramUserId}`);

    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('New user detected.');

            const referrerId = getReferrerId(tgUser);
            console.log(`DEBUG: Referrer ID detected: ${referrerId}`);

            const newUserState = {
                username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "User",
                telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`,
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

            userState = newUserState;

            if (referrerId && referrerId !== telegramUserId) {
                try {
                    await db.runTransaction(async (transaction) => {
                        const referrerRef = db.collection('users').doc(referrerId);
                        const refDoc = await transaction.get(referrerRef);

                        if (!refDoc.exists) {
                            // Create referrer account with initial referral count
                            transaction.set(referrerRef, {
                                username: "New User",
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
                            transaction.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1)
                            });
                        }
                        transaction.set(userRef, newUserState);
                    });
                    console.log("Referral transaction completed.");
                } catch (err) {
                    console.error("Referral transaction failed:", err);
                    newUserState.referredBy = null;
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
    }, (err) => {
        console.error("Error listening to user doc:", err);
    });
}

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
    document.getElementById('home-username').textContent = userState.username;
    document.getElementById('profile-name').textContent = userState.username;
    document.getElementById('telegram-username').textContent = userState.telegramUsername;
    document.getElementById('ads-watched-today').textContent = userState.tasksCompletedToday || 0;
    document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - (userState.tasksCompletedToday || 0);

    const tasksCompleted = userState.tasksCompletedToday || 0;
    document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;

    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';

    document.getElementById('earned-so-far').textContent = totalEarnedString;
    document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
    document.getElementById('total-refers').textContent = totalRefersString;
    document.getElementById('refer-earnings').textContent = referralEarningsString;
    document.getElementById('refer-count').textContent = totalRefersString;

    const joinedTasks = userState.joinedBonusTasks || [];
    joinedTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });

    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    const modalLinkInput = document.getElementById('referral-link');
    if (modalLinkInput) modalLinkInput.value = referralLink;
    const profileLinkInput = document.getElementById('profile-referral-link');
    if (profileLinkInput) profileLinkInput.value = referralLink;
}

// --- [REFERRAL COMMISSION] ---
async function payReferralCommission(earnedAmount) {
    if (!userState.referredBy) return;
    const commissionAmount = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
    if (commissionAmount <= 0) return;
    const referrerRef = db.collection('users').doc(userState.referredBy);
    return referrerRef.update({
        balance: firebase.firestore.FieldValue.increment(commissionAmount),
        referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount)
    }).catch(error => console.error("Failed to pay commission:", error));
}

// (Rest of your existing task, withdrawal, and modal functions stay the same...)

// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
    } else {
        console.warn("Telegram WebApp not found. Running in local test mode.");
        initializeApp(null);
    }
});
