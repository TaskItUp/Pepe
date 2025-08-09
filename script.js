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

// Initialize Firebase (compat)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- [GLOBAL STATE & CONSTANTS] ---
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = {
    binancepay: 10000
};

// --- [APP INITIALIZATION] ---
async function initializeApp(tgUser) {
    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
    console.log(`Initializing app for User ID: ${telegramUserId}`);

    const userRef = db.collection('users').doc(telegramUserId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
        console.log('New user detected.');

        // ✅ Correct way to get referral ID (Telegram WebApp puts start_param inside initDataUnsafe)
        const referrerIdRaw = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
        const referrerId = (referrerIdRaw && referrerIdRaw !== telegramUserId) ? referrerIdRaw : null;
        console.log(`DEBUG: Referrer ID from Telegram link: ${referrerId}`);

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
            referredBy: referrerId,
            referralEarnings: 0
        };

        if (referrerId) {
            const referrerRef = db.collection('users').doc(referrerId);
            try {
                // Atomic transaction to create new user & increment referrer totalRefers
                await db.runTransaction(async (transaction) => {
                    const refDoc = await transaction.get(referrerRef);
                    if (refDoc.exists) {
                        transaction.update(referrerRef, {
                            totalRefers: firebase.firestore.FieldValue.increment(1)
                        });
                    } else {
                        console.log("Referrer doc not found, skipping increment.");
                    }
                    transaction.set(userRef, newUserState);
                });
                console.log("Referral transaction completed.");
            } catch (err) {
                console.error("Referral transaction failed:", err);
                // Fallback: create user doc without incrementing referrer
                await userRef.set(newUserState);
            }
        } else {
            // No referral, just create user doc
            await userRef.set(newUserState);
        }
    } else {
        userState = userDoc.data();
    }

    if (!isInitialized) {
        setupTaskButtonListeners();
        listenForWithdrawalHistory();
        isInitialized = true;
    }
    updateUI();

    // Realtime listen for user doc updates after initial load
    userRef.onSnapshot((doc) => {
        if (doc.exists) {
            userState = doc.data();
            updateUI();
        }
    }, (err) => {
        console.error("Error listening to user doc:", err);
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

    // Basic stats
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

    // Mark joined tasks completed
    const joinedTasks = userState.joinedBonusTasks || [];
    joinedTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });

    // Populate dynamic referral link(s)
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

// --- [TASK HANDLERS] ---
function setupTaskButtonListeners() {
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward);

        if (joinBtn) joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
        if (verifyBtn) verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
    });
}

async function handleVerifyClick(taskId, reward) {
    if (!userState.joinedBonusTasks) userState.joinedBonusTasks = [];
    if (userState.joinedBonusTasks.includes(taskId)) {
        alert("You have already completed this task.");
        return;
    }

    const taskCard = document.getElementById(`task-${taskId}`);
    const verifyButton = taskCard ? taskCard.querySelector('.verify-btn') : null;
    if (verifyButton) {
        verifyButton.disabled = true;
        verifyButton.textContent = "Verifying...";
    }

    try {
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(reward),
            totalEarned: firebase.firestore.FieldValue.increment(reward),
            joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
        });
        await payReferralCommission(reward);
        alert(`Verification successful! You've earned ${reward} PEPE.`);
    } catch (error) {
        console.error("Error rewarding user for channel join:", error);
        alert("An error occurred. Please try again.");
        if (verifyButton) {
            verifyButton.disabled = false;
            verifyButton.textContent = "Verify";
        }
    }
}

function handleJoinClick(taskId, url) {
    const taskCard = document.getElementById(`task-${taskId}`);
    if (!taskCard) return;
    const joinButton = taskCard.querySelector('.join-btn');
    const verifyButton = taskCard.querySelector('.verify-btn');

    // open the channel link in a new tab
    window.open(url, '_blank');
    alert("After joining, return to the app and press 'Verify' to claim your reward.");

    if (verifyButton) verifyButton.disabled = false;
    if (joinButton) joinButton.disabled = true;
}

// --- [AD TASK] ---
window.completeAdTask = async function () {
    if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
        alert("You have completed all ad tasks for today!");
        return;
    }

    const taskButton = document.getElementById('start-task-button');
    try {
        taskButton.disabled = true;
        taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';

        // Show ad via your ad SDK (as in original)
        if (typeof window.show_9685198 === 'function') {
            await window.show_9685198();
        } else {
            // In test/browsers without the ad SDK, simulate a small delay
            await new Promise(res => setTimeout(res, 800));
        }

        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await payReferralCommission(AD_REWARD);
        alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
    } catch (error) {
        console.error("An error occurred during the ad task:", error);
        alert("Ad could not be shown or was closed early. Please try again.");
    } finally {
        updateUI();
    }
};

// --- [WITHDRAWAL] ---
window.submitWithdrawal = async function () {
    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const method = document.getElementById('withdraw-method').value;
    const walletId = document.getElementById('wallet-id').value.trim();
    const minAmount = WITHDRAWAL_MINIMUMS[method];

    if (isNaN(amount) || amount <= 0 || !walletId) {
        alert('Please enter a valid amount and your Binance ID or Email.');
        return;
    }
    if (amount < minAmount) {
        alert(`Withdrawal failed. Minimum is ${minAmount.toLocaleString()} PEPE.`);
        return;
    }
    if (amount > userState.balance) {
        alert('Withdrawal failed. Not enough balance.');
        return;
    }

    try {
        const historyList = document.getElementById('history-list');
        const noHistoryMsg = historyList.querySelector('.no-history');
        if (noHistoryMsg) noHistoryMsg.remove();

        const optimisticData = { amount: amount, status: 'pending', requestedAt: new Date() };
        historyList.prepend(renderHistoryItem(optimisticData));

        await db.collection('withdrawals').add({
            userId: telegramUserId,
            username: userState.telegramUsername,
            amount: amount,
            method: "Binance Pay",
            walletId: walletId,
            currency: "PEPE",
            status: "pending",
            requestedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await db.collection('users').doc(telegramUserId).update({
            balance: firebase.firestore.FieldValue.increment(-amount)
        });

        alert(`Success! Withdrawal request for ${amount.toLocaleString()} PEPE submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';
    } catch (error) {
        console.error("Withdrawal failed:", error);
        alert("There was an error submitting your request. Please try again.");
    }
};

// --- [WITHDRAW HISTORY] ---
function renderHistoryItem(withdrawalData) {
    const item = document.createElement('div');
    item.className = `history-item ${withdrawalData.status}`;
    const date = withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : withdrawalData.requestedAt;
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    item.innerHTML = `
        <div class="history-details">
            <div class="history-amount">${withdrawalData.amount.toLocaleString()} PEPE</div>
            <div class="history-date">${formattedDate}</div>
        </div>
        <div class="history-status ${withdrawalData.status}">${withdrawalData.status}</div>
    `;
    return item;
}

function listenForWithdrawalHistory() {
    const historyList = document.getElementById('history-list');
    db.collection('withdrawals')
        .where('userId', '==', telegramUserId)
        .orderBy('requestedAt', 'desc')
        .limit(10)
        .onSnapshot(querySnapshot => {
            if (querySnapshot.empty) {
                historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
                return;
            }
            historyList.innerHTML = '';
            querySnapshot.forEach(doc => {
                historyList.appendChild(renderHistoryItem(doc.data()));
            });
        });
}

// --- [REFERRAL MODAL & COPY] ---
window.openReferModal = function () {
    if (!TELEGRAM_BOT_USERNAME) {
        alert("Error: Bot username not set.");
        return;
    }
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    const input = document.getElementById('referral-link');
    if (input) input.value = referralLink;
    document.getElementById('refer-modal').style.display = 'flex';
};
window.closeReferModal = function () {
    document.getElementById('refer-modal').style.display = 'none';
};

window.copyReferralLink = function (button, inputId = 'referral-link') {
    const linkInput = document.getElementById(inputId);
    if (!linkInput) return;
    navigator.clipboard.writeText(linkInput.value).then(() => {
        const originalIcon = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { button.innerHTML = originalIcon; }, 1500);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert('Copy failed. Please copy manually.');
    });
};

window.onclick = function (event) {
    if (event.target == document.getElementById('refer-modal')) {
        closeReferModal();
    }
};

// --- [OTHER UTILITIES] ---
window.showTab = function (tabName, element) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (element) element.classList.add('active');
};

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
