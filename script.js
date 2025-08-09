// script.js (updated - fixes referral counting)

// --- [DATABASE & APP INITIALIZATION] ---
// ✅ Your Firebase configuration (from your sample)
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
const TELEGRAM_BOT_USERNAME = "TaskItUpBot"; // used to build referral link

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const JOIN_REWARD = 300;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = {
    binancepay: 10000
};

// --- [UTILITY: get start param from multiple sources] ---
function getStartParam() {
    // 1) check URL param ?start=...
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlStart = urlParams.get('start');
        if (urlStart) return urlStart;
    } catch (e) {
        console.warn("Could not parse URL params", e);
    }

    // 2) check Telegram WebApp (if inside Telegram)
    try {
        const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe;
        if (tg && tg.start_param) return tg.start_param;
    } catch (e) {
        // ignore
    }

    // 3) fallback to localStorage (useful for testing)
    const ls = localStorage.getItem('test_start_param');
    if (ls) return ls;

    return null;
}

// --- [APP INITIALIZATION] ---
async function initializeApp(tgUser) {
    // prefer Telegram user id if present, otherwise generate a local test id
    telegramUserId = tgUser ? String(tgUser.id) : getFakeUserIdForTesting();
    console.log('Initializing for user id:', telegramUserId);

    const userRef = db.collection('users').doc(telegramUserId);

    // Listen to the user document in realtime
    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('New user — creating user doc:', telegramUserId);

            // read referrerId (try multiple places)
            const referrerIdRaw = getStartParam();
            const referrerId = (referrerIdRaw && String(referrerIdRaw)) || null;

            // avoid self-referral
            const referredBy = (referrerId && referrerId !== telegramUserId) ? referrerId : null;

            // Build new user state
            const newUserState = {
                username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || `User${telegramUserId}` : `User${telegramUserId}`,
                telegramUsername: tgUser ? (tgUser.username ? `@${tgUser.username}` : `@${telegramUserId}`) : `@${telegramUserId}`,
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

            // If we have a referrer, run a transaction that:
            //  - increments referrer's totalRefers (create referrer doc if missing)
            //  - creates the new user doc
            if (referredBy) {
                const referrerRef = db.collection('users').doc(referredBy);

                try {
                    await db.runTransaction(async (tx) => {
                        const refSnap = await tx.get(referrerRef);
                        if (refSnap.exists) {
                            // increment existing referrer's counter
                            tx.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1)
                            });
                        } else {
                            // create a minimal referrer doc so the counter is visible
                            // (you may want to expand fields in production)
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

                        // create the new user doc
                        tx.set(userRef, newUserState);
                    });

                    console.log('Transaction successful: referrer incremented and user created.');
                } catch (txErr) {
                    console.error('Transaction failed when creating user + incrementing referrer:', txErr);
                    // fallback: create user doc without increment if transaction fails
                    await userRef.set(newUserState);
                }
            } else {
                // create user doc without referrer
                try {
                    await userRef.set(newUserState);
                    console.log('User doc created (no referrer).');
                } catch (err) {
                    console.error('Failed creating user doc:', err);
                }
            }
        } else {
            // existing user: load userState
            userState = doc.data();
        }

        // first time setup listeners & UI only once
        if (!isInitialized) {
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            isInitialized = true;
        }

        updateUI();
    }, (err) => {
        console.error('Error listening to user doc:', err);
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

    try {
        await referrerRef.update({
            balance: firebase.firestore.FieldValue.increment(commissionAmount),
            referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount)
        });
    } catch (err) {
        console.error('Failed to pay commission (referrer update). Attempting to create a referrer doc then update.', err);
        // As a fallback, attempt a transaction to create or update
        try {
            await db.runTransaction(async (tx) => {
                const refSnap = await tx.get(referrerRef);
                if (refSnap.exists) {
                    tx.update(referrerRef, {
                        balance: firebase.firestore.FieldValue.increment(commissionAmount),
                        referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount)
                    });
                } else {
                    tx.set(referrerRef, {
                        username: `User ${userState.referredBy}`,
                        telegramUsername: `@${userState.referredBy}`,
                        profilePicUrl: generatePlaceholderAvatar(userState.referredBy),
                        balance: commissionAmount,
                        totalRefers: 0,
                        totalEarned: 0,
                        totalAdsViewed: 0,
                        referralEarnings: commissionAmount,
                        joinedBonusTasks: []
                    });
                }
            });
        } catch (txErr) {
            console.error('Fallback transaction to pay referral commission failed:', txErr);
        }
    }
}

// --- [TASK HANDLERS] ---
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
    if (!userState.joinedBonusTasks) userState.joinedBonusTasks = [];
    if (userState.joinedBonusTasks.includes(taskId)) {
        alert("You have already completed this task.");
        return;
    }

    const userRef = db.collection('users').doc(telegramUserId);

    try {
        // Use transaction to ensure atomic add to joined tasks and increment balances
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) throw "User doc missing while verifying task.";

            // If user already has this task, abort
            const data = snap.data();
            const has = (data.joinedBonusTasks || []).includes(taskId);
            if (has) throw "Task already recorded";

            tx.update(userRef, {
                balance: firebase.firestore.FieldValue.increment(reward),
                totalEarned: firebase.firestore.FieldValue.increment(reward),
                joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
            });
        });

        // pay referral commission AFTER user receives reward
        await payReferralCommission(reward);

        alert(`Verification successful! You've earned ${reward} PEPE.`);
    } catch (err) {
        console.error('Error in verify task flow:', err);
        alert("An error occurred while verifying. Please try again.");
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
            // if ad SDK provides a promise-like API, await it
            await window.show_9685198();
        } else {
            // In test/browsers without the ad SDK, simulate a small delay
            await new Promise(res => setTimeout(res, 800));
        }

        // Use transaction to safely increment user counters and balance
        const userRef = db.collection('users').doc(telegramUserId);
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) throw "User doc not found.";
            const data = snap.data();
            const completed = data.tasksCompletedToday || 0;
            if (completed >= DAILY_TASK_LIMIT) throw "Daily limit reached.";

            tx.update(userRef, {
                balance: firebase.firestore.FieldValue.increment(AD_REWARD),
                totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
                tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
                totalAdsViewed: firebase.firestore.FieldValue.increment(1),
                lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
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

    // Ensure user has enough balance by using a transaction
    const userRef = db.collection('users').doc(telegramUserId);
    const historyRef = db.collection('withdrawals');

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) throw "User doc not found.";
            const data = snap.data();
            const currentBalance = data.balance || 0;
            if (amount > currentBalance) throw "Insufficient balance.";

            // Deduct balance and create withdrawal record
            tx.update(userRef, {
                balance: firebase.firestore.FieldValue.increment(-amount)
            });

            tx.set(historyRef.doc(), {
                userId: telegramUserId,
                username: data.telegramUsername || data.username,
                amount: amount,
                method: "Binance Pay",
                walletId: walletId,
                currency: "PEPE",
                status: "pending",
                requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        alert(`Success! Withdrawal request for ${amount.toLocaleString()} PEPE submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';
    } catch (err) {
        console.error('Withdrawal failed transaction:', err);
        alert('Withdrawal failed: ' + (err.toString ? err.toString() : 'Unknown error'));
    }
};

// --- [WITHDRAW HISTORY] ---
function renderHistoryItem(withdrawalData) {
    const item = document.createElement('div');
    item.className = `history-item ${withdrawalData.status || 'pending'}`;
    const date = withdrawalData.requestedAt && withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : (withdrawalData.requestedAt || new Date());
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    item.innerHTML = `
        <div class="history-details">
            <div class="history-amount">${withdrawalData.amount.toLocaleString()} PEPE</div>
            <div class="history-date">${formattedDate}</div>
        </div>
        <div class="history-status ${withdrawalData.status || 'pending'}">${withdrawalData.status || 'pending'}</div>
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
        }, (err) => {
            console.error('Error listening to withdrawals:', err);
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
    // If inside Telegram WebApp, access their user object
    if (window.Telegram && window.Telegram.WebApp) {
        try {
            Telegram.WebApp.ready();
        } catch (e) { /* ignore */ }
        initializeApp(window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user ? window.Telegram.WebApp.initDataUnsafe.user : null);
    } else {
        console.warn("Telegram WebApp not found. Running in local test mode.");
        initializeApp(null);
    }
});
