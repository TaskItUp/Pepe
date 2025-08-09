// ---------- CONFIG & INIT ----------
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

// App constants
const TELEGRAM_BOT_USERNAME = "TaskItUpBot"; // update if needed
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

let telegramUserId = null;
let userState = null;
let isInitialized = false;

// ---------- UTIL ----------
function getFakeUserIdForTesting() {
    let id = localStorage.getItem('localAppUserId');
    if (!id) {
        id = 'local_test_' + Date.now().toString(36);
        localStorage.setItem('localAppUserId', id);
    }
    return id;
}
function generatePlaceholderAvatar(userId) {
    return `https://i.pravatar.cc/150?u=${encodeURIComponent(userId)}`;
}
function formatNumber(n) {
    return Math.floor(n || 0).toLocaleString();
}

// ---------- UI UPDATES ----------
function updateUI() {
    if (!userState) return;

    // Basics
    document.getElementById('home-username').textContent = userState.username || 'User';
    document.getElementById('profile-name').textContent = userState.username || 'User';
    document.getElementById('telegram-username').textContent = userState.telegramUsername || '@unknown';

    const bal = formatNumber(userState.balance);
    document.getElementById('balance-home').textContent = bal;
    document.getElementById('withdraw-balance').textContent = bal;
    document.getElementById('profile-balance').textContent = bal;

    // Tasks & progress
    const completed = userState.tasksCompletedToday || 0;
    document.getElementById('ads-watched-today').textContent = completed;
    document.getElementById('ads-left-today').textContent = Math.max(DAILY_TASK_LIMIT - completed, 0);
    document.getElementById('tasks-completed').textContent = `${completed} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('task-progress-bar').style.width = `${(completed / DAILY_TASK_LIMIT) * 100}%`;
    document.getElementById('start-task-button').disabled = completed >= DAILY_TASK_LIMIT;
    document.getElementById('start-task-button').innerHTML = completed >= DAILY_TASK_LIMIT
        ? '<i class="fas fa-check-circle"></i> All tasks done'
        : '<i class="fas fa-play-circle"></i> Watch Ad';

    // Stats
    document.getElementById('earned-so-far').textContent = formatNumber(userState.totalEarned);
    document.getElementById('total-ads-viewed').textContent = (userState.totalAdsViewed || 0);
    document.getElementById('total-refers').textContent = (userState.totalRefers || 0);
    document.getElementById('refer-count').textContent = (userState.totalRefers || 0);
    document.getElementById('refer-earnings').textContent = formatNumber(userState.referralEarnings);

    // avatars
    document.querySelectorAll('#home-profile-pic, #profile-pic-large').forEach(img => {
        if (img) img.src = userState.profilePicUrl || generatePlaceholderAvatar(telegramUserId);
    });

    // Referral link(s)
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    const modalInput = document.getElementById('referral-link');
    const profileInput = document.getElementById('profile-referral-link');
    if (modalInput) modalInput.value = referralLink;
    if (profileInput) profileInput.value = referralLink;

    // mark completed bonus tasks visually
    const joined = userState.joinedBonusTasks || [];
    document.querySelectorAll('.task-card').forEach(card => {
        const taskId = card.dataset.taskId;
        if (joined.includes(taskId)) {
            card.classList.add('completed');
        } else {
            card.classList.remove('completed');
            const verifyBtn = card.querySelector('.verify-btn');
            if (verifyBtn) verifyBtn.disabled = true;
        }
    });
}

// ---------- REFERRAL / USER CREATION ----------
/*
Flow:
- Determine telegramUserId (Telegram WebApp or local test).
- Listen on users/doc for realtime updates.
- If doc doesn't exist -> create it. If start_param exists and is a valid referrer id and not the same as this user:
    - transactionally increment referrer's totalRefers (create minimal referrer doc if missing).
    - set new user doc with referredBy.
- onSnapshot will then provide userState to update UI.
*/
async function initializeApp(tgUser) {
    telegramUserId = tgUser ? String(tgUser.id) : getFakeUserIdForTesting();
    console.log('Initializing app for', telegramUserId);

    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            // NEW USER: build baseline fields
            const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
            const referredBy = (startParam && startParam !== telegramUserId) ? String(startParam) : null;

            const baseUser = {
                username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || `User` : `User`,
                telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@local_test`,
                profilePicUrl: generatePlaceholderAvatar(telegramUserId),
                balance: 0,
                tasksCompletedToday: 0,
                lastTaskTimestamp: null,
                totalEarned: 0,
                totalAdsViewed: 0,
                totalRefers: 0,
                referralEarnings: 0,
                joinedBonusTasks: [],
                referredBy: referredBy // may be null
            };

            try {
                if (referredBy) {
                    // Use transaction: if referrer exists increment, else create a minimal referrer doc
                    const referrerRef = db.collection('users').doc(referredBy);
                    await db.runTransaction(async (tx) => {
                        const refDoc = await tx.get(referrerRef);
                        if (refDoc.exists) {
                            tx.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1)
                            });
                        } else {
                            // If referrer doc doesn't exist, create a minimal profile so they still get the refer count
                            tx.set(referrerRef, {
                                username: `@${referredBy}`,
                                telegramUsername: `@${referredBy}`,
                                profilePicUrl: generatePlaceholderAvatar(referredBy),
                                balance: 0,
                                tasksCompletedToday: 0,
                                lastTaskTimestamp: null,
                                totalEarned: 0,
                                totalAdsViewed: 0,
                                totalRefers: 1,
                                referralEarnings: 0,
                                joinedBonusTasks: [],
                                referredBy: null
                            });
                        }
                        // create the new user doc only after we've handled the referrer increment
                        tx.set(userRef, baseUser);
                    });
                } else {
                    // No referrer — simple create
                    await userRef.set(baseUser);
                }
                console.log('New user created successfully.');
            } catch (err) {
                console.error('Error creating user or handling referral:', err);
                // fallback: ensure user doc exists even if transaction failed
                try { await userRef.set(baseUser); } catch (e) { console.error('Fallback creation failed', e); }
            }
            return; // next snapshot will fire with doc.exists true
        }

        // Existing user doc: keep live state
        userState = doc.data();
        if (!isInitialized) {
            // bind UI handlers once
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            isInitialized = true;
        }
        updateUI();
    }, (err) => {
        console.error('Listening to user doc failed:', err);
    });
}

// ---------- REFERRAL COMMISSION ----------
async function payReferralCommission(earnedAmount) {
    if (!userState || !userState.referredBy) return;
    const commission = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
    if (commission <= 0) return;

    const referrerRef = db.collection('users').doc(String(userState.referredBy));
    try {
        // increment both balance and referralEarnings
        await referrerRef.update({
            balance: firebase.firestore.FieldValue.increment(commission),
            referralEarnings: firebase.firestore.FieldValue.increment(commission)
        });
    } catch (err) {
        console.error('Failed to pay referral commission:', err);
        // If update fails because doc doesn't exist, attempt create
        try {
            await referrerRef.set({
                username: `@${userState.referredBy}`,
                telegramUsername: `@${userState.referredBy}`,
                profilePicUrl: generatePlaceholderAvatar(userState.referredBy),
                balance: commission,
                tasksCompletedToday: 0,
                lastTaskTimestamp: null,
                totalEarned: 0,
                totalAdsViewed: 0,
                totalRefers: 0,
                referralEarnings: commission,
                joinedBonusTasks: [],
                referredBy: null
            }, { merge: true });
        } catch (e) {
            console.error('Second attempt to credit referrer failed:', e);
        }
    }
}

// ---------- TASKS (JOIN / VERIFY / ADs) ----------
function setupTaskButtonListeners() {
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward || '0', 10);

        if (joinBtn) joinBtn.addEventListener('click', () => handleJoinClick(card, url));
        if (verifyBtn) verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
        // enable verify only if not joined yet
        if (verifyBtn) verifyBtn.disabled = true;
    });
}

function handleJoinClick(card, url) {
    window.open(url, '_blank');
    alert('After joining the channel, return here and tap Verify to claim the reward.');
    const verifyBtn = card.querySelector('.verify-btn');
    if (verifyBtn) verifyBtn.disabled = false;
    const joinBtn = card.querySelector('.join-btn');
    if (joinBtn) joinBtn.disabled = true;
}

async function handleVerifyClick(taskId, reward) {
    if (!userState) return;
    if (!Array.isArray(userState.joinedBonusTasks)) userState.joinedBonusTasks = [];

    if (userState.joinedBonusTasks.includes(taskId)) {
        alert('You already completed this task.');
        return;
    }

    try {
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(reward),
            totalEarned: firebase.firestore.FieldValue.increment(reward),
            joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
        });
        // pay commission to referrer of THIS user
        await payReferralCommission(reward);
        alert(`Verification successful — you earned ${reward} PEPE!`);
    } catch (err) {
        console.error('Error verifying task:', err);
        alert('Verification failed. Please try again.');
    }
}

// AD TASK
window.completeAdTask = async function () {
    if (!userState) return alert('User not loaded yet.');
    if ((userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
        alert('You completed all ad tasks for today.');
        return;
    }

    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = true;
    const originalHTML = taskButton.innerHTML;
    taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';

    try {
        // simulate ad or call SDK
        if (typeof window.show_9685198 === 'function') {
            await window.show_9685198();
        } else {
            // demo fallback
            await new Promise(res => setTimeout(res, 900));
        }

        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Pay referrer (who referred THIS user)
        await payReferralCommission(AD_REWARD);
        alert(`Success! ${AD_REWARD} PEPE added to your balance.`);
    } catch (err) {
        console.error('Error during ad task:', err);
        alert('Ad failed or was closed. Try again.');
    } finally {
        taskButton.disabled = false;
        taskButton.innerHTML = originalHTML;
    }
};

// ---------- WITHDRAWALS ----------
window.submitWithdrawal = async function () {
    if (!userState) return alert('User not ready.');
    const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
    const method = document.getElementById('withdraw-method').value;
    const walletId = document.getElementById('wallet-id').value.trim();
    const min = WITHDRAWAL_MINIMUMS[method];

    if (!amount || amount <= 0 || !walletId) return alert('Please enter amount and wallet ID.');
    if (amount < min) return alert(`Minimum withdrawal for ${method} is ${min.toLocaleString()} PEPE.`);
    if (amount > (userState.balance || 0)) return alert('Insufficient balance.');

    try {
        const historyList = document.getElementById('history-list');
        const optimistic = { amount, status: 'pending', requestedAt: new Date() };
        // optimistic UI
        if (historyList) {
            if (historyList.querySelector('.no-history')) historyList.innerHTML = '';
            historyList.prepend(renderHistoryItem(optimistic));
        }

        await db.collection('withdrawals').add({
            userId: telegramUserId,
            username: userState.telegramUsername || userState.username,
            amount,
            method: method,
            walletId,
            currency: 'PEPE',
            status: 'pending',
            requestedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await db.collection('users').doc(telegramUserId).update({
            balance: firebase.firestore.FieldValue.increment(-amount)
        });

        alert(`Withdrawal request for ${amount.toLocaleString()} PEPE submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';
    } catch (err) {
        console.error('Withdraw failed:', err);
        alert('Error submitting withdrawal.');
    }
};

function renderHistoryItem(withdrawalData) {
    const item = document.createElement('div');
    item.className = `history-item ${withdrawalData.status || 'pending'}`;
    const dateObj = withdrawalData.requestedAt && withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : (withdrawalData.requestedAt || new Date());
    const formattedDate = new Date(dateObj).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    item.innerHTML = `
        <div class="history-details">
            <div class="history-amount">${(withdrawalData.amount || 0).toLocaleString()} PEPE</div>
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
        .limit(20)
        .onSnapshot(qs => {
            if (!historyList) return;
            if (qs.empty) {
                historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
                return;
            }
            historyList.innerHTML = '';
            qs.forEach(doc => {
                historyList.appendChild(renderHistoryItem(doc.data()));
            });
        }, (err) => {
            console.error('Withdraw history listen error:', err);
        });
}

// ---------- REFERRAL MODAL & COPY ----------
window.openReferModal = function () {
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    const input = document.getElementById('referral-link');
    if (input) input.value = referralLink;
    const modal = document.getElementById('refer-modal');
    if (modal) { modal.style.display = 'flex'; modal.setAttribute('aria-hidden', 'false'); }
};
window.closeReferModal = function () {
    const modal = document.getElementById('refer-modal');
    if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); }
};

window.copyReferralLink = function (buttonEl, inputId = 'referral-link') {
    const input = document.getElementById(inputId);
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
        const original = buttonEl.innerHTML;
        buttonEl.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => buttonEl.innerHTML = original, 1400);
    }).catch(err => {
        console.error('Copy failed', err);
        alert('Copy failed — please select and copy manually.');
    });
};

window.onclick = function (e) {
    const modal = document.getElementById('refer-modal');
    if (e.target === modal) closeReferModal();
};

// ---------- NAV TAB ----------
window.showTab = function (tabName, element) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const el = document.getElementById(tabName);
    if (el) el.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (element) element.classList.add('active');
};

// ---------- APP ENTRY ----------
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        const tgUser = Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user ? Telegram.WebApp.initDataUnsafe.user : null;
        initializeApp(tgUser);
    } else {
        console.warn('Telegram WebApp not found. Running in local test mode.');
        initializeApp(null);
    }
});
