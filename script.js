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
    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
    console.log(`Initializing app for User ID: ${telegramUserId}`);

    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('New user detected.');

            const referrerId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
            console.log(`DEBUG: Referrer ID from Telegram link: ${referrerId}`);

            const newUserState = {
                username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "User",
                telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`,
                profilePicUrl: generatePlaceholderAvatar(telegramUserId),
                balance: 0, tasksCompletedToday: 0, lastTaskTimestamp: null,
                totalEarned: 0, totalAdsViewed: 0,
                totalRefers: 0, // ✅ do NOT reset existing users' count
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
            userState = doc.data();
        }

        if (!isInitialized) {
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            setupNavigationBar(); // ✅ Fix navbar
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

// --- [NAVIGATION BAR FIX] ---
function setupNavigationBar() {
    const tabs = document.querySelectorAll('.tab-content');
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('onclick').match(/'([^']+)'/)[1];
            tabs.forEach(tab => tab.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
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
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT
        ? '<i class="fas fa-check-circle"></i> All tasks done'
        : '<i class="fas fa-play-circle"></i> Watch Ad';
    document.getElementById('earned-so-far').textContent = totalEarnedString;
    document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
    document.getElementById('total-refers').textContent = totalRefersString;
    document.getElementById('refer-earnings').textContent = referralEarningsString;
    document.getElementById('refer-count').textContent = totalRefersString;
}

// --- [COMMISSION FIX] ---
async function payReferralCommission(earnedAmount) {
    if (!userState.referredBy) return;

    const commissionAmount = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
    if (commissionAmount <= 0) return;

    try {
        await db.collection('users').doc(userState.referredBy).update({
            balance: firebase.firestore.FieldValue.increment(commissionAmount),
            referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount)
        });
        console.log(`Commission of ${commissionAmount} PEPE added to referrer ${userState.referredBy}`);
    } catch (error) {
        console.error("Failed to pay commission:", error);
    }
}

// --- [BONUS TASK HANDLERS] ---
function setupTaskButtonListeners() {
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward);

        if (joinBtn) {
            joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
        }
        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
        }
    });
}

async function handleVerifyClick(taskId, reward) {
    if (userState.joinedBonusTasks.includes(taskId)) {
        alert("You have already completed this task.");
        return;
    }
    const taskCard = document.getElementById(`task-${taskId}`);
    const verifyButton = taskCard.querySelector('.verify-btn');
    verifyButton.disabled = true;
    verifyButton.textContent = "Verifying...";

    try {
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(reward),
            totalEarned: firebase.firestore.FieldValue.increment(reward),
            joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
        });
        await payReferralCommission(reward); // ✅ commission added here
        alert(`Verification successful! You've earned ${reward} PEPE.`);
    } catch (error) {
        console.error("Error rewarding user:", error);
        alert("An error occurred. Please try again.");
        verifyButton.disabled = false;
        verifyButton.textContent = "Verify";
    }
}

function handleJoinClick(taskId, url) {
    const taskCard = document.getElementById(`task-${taskId}`);
    if (!taskCard) return;
    const joinButton = taskCard.querySelector('.join-btn');
    const verifyButton = taskCard.querySelector('.verify-btn');
    window.open(url, '_blank');
    alert("After joining, return and press 'Verify' to claim your reward.");
    if (verifyButton) verifyButton.disabled = false;
    if (joinButton) joinButton.disabled = true;
}

// --- [AD TASK HANDLER] ---
window.completeAdTask = async function () {
    if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
        alert("You have completed all ad tasks for today!");
        return;
    }
    const taskButton = document.getElementById('start-task-button');
    try {
        taskButton.disabled = true;
        taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
        await window.show_9685198();
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        await payReferralCommission(AD_REWARD); // ✅ commission added here
        alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
    } catch (error) {
        console.error("Ad error:", error);
        alert("Ad could not be shown. Please try again.");
    } finally {
        updateUI();
    }
};

// --- [REFERRAL MODAL] ---
window.openReferModal = function () {
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    document.getElementById('referral-link').value = referralLink;
    document.getElementById('refer-modal').style.display = 'flex';
};
window.closeReferModal = function () {
    document.getElementById('refer-modal').style.display = 'none';
};
window.copyReferralLink = function (button) {
    const linkInput = document.getElementById('referral-link');
    navigator.clipboard.writeText(linkInput.value).then(() => {
        const originalIcon = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { button.innerHTML = originalIcon; }, 1500);
    }).catch(err => console.error('Failed to copy text:', err));
};
window.onclick = function (event) {
    if (event.target == document.getElementById('refer-modal')) {
        closeReferModal();
    }
};

// --- [APP START] ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
    } else {
        console.warn("Not in Telegram. Running test mode.");
        initializeApp(null);
    }
});
