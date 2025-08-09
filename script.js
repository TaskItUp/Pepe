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

// --- [GLOBAL STATE & CONSTANTS] ---
let userState = null;
let telegramUser = null;
let telegramUserId = null;
let isInitialized = false;
let unsubscribeUser = () => {};
let unsubscribeHistory = () => {};
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- [CORE APP LOGIC] ---

/**
 * Initializes the entire application.
 */
function initializeApp(tgUser) {
    if (!tgUser) {
        document.getElementById('loading-text').textContent = 'Cannot verify user. Please launch from Telegram.';
        return;
    }
    telegramUser = tgUser;
    telegramUserId = tgUser.id.toString();
    console.log(`Initializing for User ID: ${telegramUserId}`);
    const userRef = db.collection('users').doc(telegramUserId);
    unsubscribeUser = userRef.onSnapshot(handleUserSnapshot, handleUserError);
}

/**
 * Handles real-time updates for the user's document.
 */
async function handleUserSnapshot(doc) {
    if (!doc.exists && !isInitialized) {
        isInitialized = true;
        document.getElementById('loading-text').textContent = 'Checking for referrals...';
        await processNewUser();
    } else if (doc.exists) {
        userState = doc.data();
        if (!isInitialized) {
            isInitialized = true;
            setupAppForUser();
        }
        updateUI();
    }
}

/**
 * Processes a new user, checking for a referral voucher and creating the account.
 */
async function processNewUser() {
    const voucherId = telegramUser?.start_param;
    const newUserRef = db.collection('users').doc(telegramUserId);
    
    const newUserState = {
        username: `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || 'New User',
        telegramUsername: `@${telegramUser.username || telegramUserId}`,
        profilePicUrl: `https://i.pravatar.cc/150?u=${telegramUserId}`,
        balance: 0, tasksCompletedToday: 0, lastTaskTimestamp: null,
        totalEarned: 0, totalAdsViewed: 0, totalRefers: 0,
        joinedBonusTasks: [], referredBy: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!voucherId) {
        // No voucher, just create the user.
        console.log("No referral voucher found. Creating new user.");
        await newUserRef.set(newUserState);
        return;
    }

    // Voucher exists, perform the transactional claim.
    console.log(`Voucher ${voucherId} found. Attempting to claim.`);
    const voucherRef = db.collection('referralLedger').doc(voucherId);

    try {
        await db.runTransaction(async (transaction) => {
            const voucherDoc = await transaction.get(voucherRef);
            if (!voucherDoc.exists || voucherDoc.data().status !== 'pending') {
                // Voucher is invalid or already claimed, create user normally.
                console.warn("Voucher is invalid or already claimed.");
                transaction.set(newUserRef, newUserState);
                return;
            }

            // --- Success Path ---
            const referrerId = voucherDoc.data().referrerId;
            if (!referrerId) {
                console.error("Voucher is corrupted, no referrerId found.");
                transaction.set(newUserRef, newUserState); // Create user anyway
                transaction.delete(voucherRef); // Delete bad voucher
                return;
            }

            const referrerRef = db.collection('users').doc(referrerId);
            newUserState.referredBy = referrerId;
            
            console.log(`Voucher is valid. Crediting referrer: ${referrerId}`);
            
            // This is the magic 3-part transaction:
            transaction.set(newUserRef, newUserState);
            transaction.update(referrerRef, { totalRefers: firebase.firestore.FieldValue.increment(1) });
            transaction.delete(voucherRef);
        });
        console.log("Referral claimed successfully!");
    } catch (error) {
        console.error("Referral transaction failed:", error);
        // If transaction fails, just create the user so they aren't stuck.
        await newUserRef.set(newUserState);
    }
}


function handleUserError(error) {
    console.error("Firestore listener failed:", error);
    document.getElementById('loading-text').textContent = 'Failed to connect to the database.';
}

/**
 * Sets up listeners and shows the main app content. Called only once.
 */
function setupAppForUser() {
    console.log("Setting up listeners and UI.");
    unsubscribeHistory = db.collection('withdrawals').where('userId', '==', telegramUserId).orderBy('requestedAt', 'desc').limit(10).onSnapshot(updateWithdrawalHistory);
    setupTaskButtonListeners();
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
}

/**
 * Updates all UI elements with data from the global `userState`.
 */
function updateUI() {
    if (!userState) return;

    const { balance = 0, tasksCompletedToday = 0, totalEarned = 0, totalAdsViewed = 0, totalRefers = 0, profilePicUrl, username, telegramUsername, joinedBonusTasks = [] } = userState;

    const balanceString = Math.floor(balance).toLocaleString();
    const totalEarnedString = Math.floor(totalEarned).toLocaleString();
    const totalRefersString = Math.floor(totalRefers).toLocaleString();

    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => { if (profilePicUrl) img.src = profilePicUrl; });
    document.getElementById('balance-home').textContent = balanceString;
    document.getElementById('withdraw-balance').textContent = balanceString;
    document.getElementById('profile-balance').textContent = balanceString;
    document.getElementById('home-username').textContent = username;
    document.getElementById('profile-name').textContent = username;
    document.getElementById('telegram-username').textContent = telegramUsername;
    document.getElementById('ads-watched-today').textContent = tasksCompletedToday;
    document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - tasksCompletedToday;
    document.getElementById('tasks-completed').textContent = `${tasksCompletedToday} / ${DAILY_TASK_LIMIT}`;
    document.getElementById('task-progress-bar').style.width = `${(tasksCompletedToday / DAILY_TASK_LIMIT) * 100}%`;
    
    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = tasksCompletedToday >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompletedToday >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';
    
    document.getElementById('earned-so-far').textContent = totalEarnedString;
    document.getElementById('total-ads-viewed').textContent = totalAdsViewed;
    document.getElementById('total-refers').textContent = totalRefersString;
    document.getElementById('refer-count').textContent = totalRefersString;

    joinedBonusTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });
}

/**
 * Generates and displays the user's unique referral link.
 */
async function openReferModal() {
    const linkInput = document.getElementById('referral-link');
    const copyButton = linkInput.nextElementSibling;
    
    linkInput.value = 'Generating...';
    copyButton.disabled = true;
    document.getElementById('refer-modal').style.display = 'flex';

    try {
        const voucherRef = db.collection('referralLedger').doc();
        await voucherRef.set({
            referrerId: telegramUserId,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        linkInput.value = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${voucherRef.id}`;
        copyButton.disabled = false;
    } catch (error) {
        console.error("Could not generate referral link:", error);
        linkInput.value = "Error. Please try again.";
    }
}

/**
 * Handles the ad completion task.
 */
window.completeAdTask = async function() {
    if (!userState || userState.tasksCompletedToday >= DAILY_TASK_LIMIT) return;
    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = true;
    taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
    try {
        await window.show_9685198();
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert(`Success! ${AD_REWARD} PEPE added.`);
    } catch (error) {
        console.error("Ad task failed:", error);
        alert("Ad could not be shown or was closed early.");
    }
}

/**
 * Handles withdrawal requests.
 */
window.submitWithdrawal = async function() {
    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const walletId = document.getElementById('wallet-id').value.trim();
    const minAmount = WITHDRAWAL_MINIMUMS.binancepay;

    if (isNaN(amount) || amount <= 0 || !walletId) { alert('Please enter a valid amount and your Binance ID or Email.'); return; }
    if (amount < minAmount) { alert(`Withdrawal failed. Minimum is ${minAmount.toLocaleString()} PEPE.`); return; }
    if (amount > userState.balance) { alert('Withdrawal failed. Insufficient balance.'); return; }

    try {
        const userRef = db.collection('users').doc(telegramUserId);
        const withdrawalRef = db.collection('withdrawals').doc();
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists || amount > userDoc.data().balance) throw new Error("Insufficient balance.");
            transaction.set(withdrawalRef, {
                userId: telegramUserId, username: userState.telegramUsername, amount,
                method: "Binance Pay", walletId, currency: "PEPE", status: "pending",
                requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            transaction.update(userRef, { balance: firebase.firestore.FieldValue.increment(-amount) });
        });
        alert(`Success! Your withdrawal request for ${amount.toLocaleString()} PEPE has been submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';
    } catch (error) {
        console.error("Withdrawal failed:", error);
        alert(`Error: ${error.message}`);
    }
}

function updateWithdrawalHistory(querySnapshot) {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    historyList.innerHTML = querySnapshot.empty ? '<p class="no-history">You have no withdrawal history yet.</p>' : '';
    querySnapshot.forEach(doc => {
        const w = doc.data();
        const date = w.requestedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        historyList.innerHTML += `<div class="history-item ${w.status}"><div class="history-details"><div class="history-amount">${w.amount.toLocaleString()} PEPE</div><div class="history-date">${date}</div></div><div class="history-status ${w.status}">${w.status}</div></div>`;
    });
}


// --- [UTILITY & OTHER FUNCTIONS] ---
function setupTaskButtonListeners() { document.querySelectorAll('.task-card').forEach(card => { const joinBtn = card.querySelector('.join-btn'); const verifyBtn = card.querySelector('.verify-btn'); const taskId = card.dataset.taskId; const url = card.dataset.url; const reward = parseInt(card.dataset.reward); if (joinBtn) { joinBtn.addEventListener('click', () => { handleJoinClick(taskId, url); }); } if (verifyBtn) { verifyBtn.addEventListener('click', () => { handleVerifyClick(taskId, reward); }); } }); }
async function handleVerifyClick(taskId, reward) { if (userState.joinedBonusTasks.includes(taskId)) { alert("You have already completed this task."); return; } const taskCard = document.getElementById(`task-${taskId}`); const verifyButton = taskCard.querySelector('.verify-btn'); verifyButton.disabled = true; verifyButton.textContent = "Verifying..."; try { const userRef = db.collection('users').doc(telegramUserId); await userRef.update({ balance: firebase.firestore.FieldValue.increment(reward), totalEarned: firebase.firestore.FieldValue.increment(reward), joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId) }); alert(`Verification successful! You've earned ${reward} PEPE.`); } catch (error) { console.error("Error rewarding user:", error); alert("An error occurred. Please try again."); verifyButton.disabled = false; verifyButton.textContent = "Verify"; } }
function handleJoinClick(taskId, url) { const taskCard = document.getElementById(`task-${taskId}`); if (!taskCard) return; const joinButton = taskCard.querySelector('.join-btn'); const verifyButton = taskCard.querySelector('.verify-btn'); window.open(url, '_blank'); alert("After joining, return to the app and press 'Verify' to claim your reward."); if (verifyButton) verifyButton.disabled = false; if (joinButton) joinButton.disabled = true; }
window.showTab = function(tabName, element) { document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); document.getElementById(tabName).classList.add('active'); document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active'); }
window.closeReferModal = function() { document.getElementById('refer-modal').style.display = 'none'; }
window.copyReferralLink = function(button) { const linkInput = document.getElementById('referral-link'); navigator.clipboard.writeText(linkInput.value).then(() => { const originalIcon = button.innerHTML; button.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { button.innerHTML = originalIcon; }, 1500); }).catch(err => console.error('Failed to copy text: ', err)); }
window.onclick = function(event) { if (event.target == document.getElementById('refer-modal')) { closeReferModal(); } }

// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
    } else {
        console.warn("Telegram script not found.");
        document.getElementById('loading-text').textContent = 'Please run this app inside Telegram.';
    }
});
