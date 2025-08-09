// =========================
// Firebase Initialization
// =========================
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

// =========================
// Constants
// =========================
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const JOIN_REWARD = 300;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// =========================
// Helper Functions
// =========================
function getStartParam() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlStart = urlParams.get('start');
        if (urlStart) return urlStart;
    } catch {}
    try {
        const tg = window.Telegram?.WebApp?.initDataUnsafe;
        if (tg?.start_param) return tg.start_param;
    } catch {}
    const ls = localStorage.getItem('test_start_param');
    if (ls) return ls;
    return null;
}
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

// =========================
// App Initialization
// =========================
async function initializeApp(tgUser) {
    telegramUserId = tgUser ? String(tgUser.id) : getFakeUserIdForTesting();
    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            const referrerIdRaw = getStartParam();
            const referredBy = (referrerIdRaw && referrerIdRaw !== telegramUserId) ? String(referrerIdRaw) : null;

            const newUserState = {
                username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || `User${telegramUserId}` : `User${telegramUserId}`,
                telegramUsername: tgUser?.username ? `@${tgUser.username}` : `@${telegramUserId}`,
                profilePicUrl: generatePlaceholderAvatar(telegramUserId),
                balance: 0,
                tasksCompletedToday: 0,
                lastTaskTimestamp: null,
                totalEarned: 0,
                totalAdsViewed: 0,
                totalRefers: 0,
                joinedBonusTasks: [],
                referredBy: referredBy,
                referralEarnings: 0
            };

            if (referredBy) {
                const referrerRef = db.collection('users').doc(referredBy);
                try {
                    await db.runTransaction(async (tx) => {
                        const refSnap = await tx.get(referrerRef);
                        if (refSnap.exists) {
                            tx.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1)
                            });
                        } else {
                            tx.set(referrerRef, {
                                username: `User ${referredBy}`,
                                telegramUsername: `@${referredBy}`,
                                profilePicUrl: generatePlaceholderAvatar(referredBy),
                                balance: 0,
                                totalRefers: 1,
                                totalEarned: 0,
                                totalAdsViewed: 0,
                                referralEarnings: 0,
                                joinedBonusTasks: []
                            });
                        }
                        tx.set(userRef, newUserState);
                    });
                } catch (err) {
                    console.error('Referral transaction failed:', err);
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

// =========================
// UI Update
// =========================
function updateUI() {
    if (!userState) return;

    const balanceString = Math.floor(userState.balance || 0).toLocaleString();
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
    document.getElementById('tasks-completed').textContent = `${userState.tasksCompletedToday || 0} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('task-progress-bar').style.width = `${((userState.tasksCompletedToday || 0) / DAILY_TASK_LIMIT) * 100}%`;
    document.getElementById('earned-so-far').textContent = (userState.totalEarned || 0).toLocaleString();
    document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
    document.getElementById('total-refers').textContent = (userState.totalRefers || 0).toLocaleString();
    document.getElementById('refer-earnings').textContent = (userState.referralEarnings || 0).toLocaleString();
    document.getElementById('refer-count').textContent = (userState.totalRefers || 0).toLocaleString();

    (userState.joinedBonusTasks || []).forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });

    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    document.getElementById('referral-link').value = referralLink;
    document.getElementById('profile-referral-link').value = referralLink;
}

// =========================
// Referral Commission
// =========================
async function payReferralCommission(amount) {
    if (!userState.referredBy) return;
    const commission = Math.floor(amount * REFERRAL_COMMISSION_RATE);
    if (commission <= 0) return;
    const referrerRef = db.collection('users').doc(userState.referredBy);
    await referrerRef.update({
        balance: firebase.firestore.FieldValue.increment(commission),
        referralEarnings: firebase.firestore.FieldValue.increment(commission)
    }).catch(err => console.error('Commission update failed:', err));
}

// =========================
// Task Handlers
// =========================
function setupTaskButtonListeners() {
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward) || JOIN_REWARD;
        if (joinBtn) joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
        if (verifyBtn) verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
    });
}
async function handleVerifyClick(taskId, reward) {
    if (userState.joinedBonusTasks?.includes(taskId)) {
        alert("Task already completed.");
        return;
    }
    await db.collection('users').doc(telegramUserId).update({
        balance: firebase.firestore.FieldValue.increment(reward),
        totalEarned: firebase.firestore.FieldValue.increment(reward),
        joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
    });
    await payReferralCommission(reward);
    alert(`+${reward} PEPE added!`);
}
function handleJoinClick(taskId, url) {
    window.open(url, '_blank');
    alert("Join the channel and come back to Verify.");
    document.querySelector(`#task-${taskId} .verify-btn`).disabled = false;
}

// =========================
// Ad Task
// =========================
window.completeAdTask = async function () {
    if ((userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
        alert("Daily limit reached.");
        return;
    }
    if (typeof window.show_9685198 === 'function') {
        await window.show_9685198();
    }
    await db.collection('users').doc(telegramUserId).update({
        balance: firebase.firestore.FieldValue.increment(AD_REWARD),
        totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
        tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
        totalAdsViewed: firebase.firestore.FieldValue.increment(1),
        lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    await payReferralCommission(AD_REWARD);
    updateUI();
};

// =========================
// Withdrawals
// =========================
window.submitWithdrawal = async function () {
    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const method = document.getElementById('withdraw-method').value;
    const walletId = document.getElementById('wallet-id').value.trim();
    if (amount < WITHDRAWAL_MINIMUMS[method]) {
        alert("Minimum withdrawal not met.");
        return;
    }
    if (amount > userState.balance) {
        alert("Insufficient balance.");
        return;
    }
    await db.collection('withdrawals').add({
        userId: telegramUserId,
        username: userState.telegramUsername,
        amount,
        method: "Binance Pay",
        walletId,
        currency: "PEPE",
        status: "pending",
        requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('users').doc(telegramUserId).update({
        balance: firebase.firestore.FieldValue.increment(-amount)
    });
    alert("Withdrawal submitted.");
};

// =========================
// Withdraw History
// =========================
function listenForWithdrawalHistory() {
    const list = document.getElementById('history-list');
    db.collection('withdrawals')
        .where('userId', '==', telegramUserId)
        .orderBy('requestedAt', 'desc')
        .limit(10)
        .onSnapshot(snap => {
            if (snap.empty) {
                list.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
                return;
            }
            list.innerHTML = '';
            snap.forEach(doc => {
                const d = doc.data();
                const div = document.createElement('div');
                div.className = `history-item ${d.status}`;
                div.innerHTML = `<div class="history-details">
                    <div class="history-amount">${d.amount} PEPE</div>
                    <div class="history-date">${d.requestedAt?.toDate().toLocaleDateString()}</div>
                </div>
                <div class="history-status ${d.status}">${d.status}</div>`;
                list.appendChild(div);
            });
        });
}

// =========================
// Referral Modal
// =========================
window.openReferModal = function () {
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    document.getElementById('referral-link').value = referralLink;
    document.getElementById('refer-modal').style.display = 'flex';
};
window.closeReferModal = function () {
    document.getElementById('refer-modal').style.display = 'none';
};
window.copyReferralLink = function (btn, id = 'referral-link') {
    const link = document.getElementById(id).value;
    navigator.clipboard.writeText(link).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
    });
};

// =========================
// Tab Navigation
// =========================
window.showTab = function (name, el) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
};

// =========================
// Entry Point
// =========================
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        const tgUser = window.Telegram.WebApp.initDataUnsafe?.user || null;
        initializeApp(tgUser);
    } else {
        console.warn("Not inside Telegram WebApp — running in test mode.");
        initializeApp(null);
    }
});
