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
const functions = firebase.functions();

// --- [GLOBAL STATE & CONSTANTS] ---
let userState = null;
let telegramUser = null;
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- [CORE APP LOGIC] ---

function initializeApp(tgUser) {
    if (!tgUser) {
        document.getElementById('loading-text').textContent = 'Cannot verify user. Please launch from Telegram.';
        return;
    }
    telegramUser = tgUser;
    telegramUserId = tgUser.id.toString();
    console.log(`Initializing for User ID: ${telegramUserId}`);
    
    // Listen to the user's document. This is our single source of truth.
    db.collection('users').doc(telegramUserId).onSnapshot(handleUserSnapshot, handleUserError);
}

async function handleUserSnapshot(doc) {
    if (!doc.exists && !isInitialized) {
        // --- NEW USER FLOW ---
        isInitialized = true;
        document.getElementById('loading-text').textContent = 'Creating your account...';
        
        const referralToken = telegramUser?.start_param;
        const claimReferralToken = functions.httpsCallable('claimReferralToken');
        try {
            await claimReferralToken({ token: referralToken, tgUser: telegramUser });
            // The listener will automatically receive the new user data, triggering the 'else' block.
        } catch (error) {
            console.error("Critical error during account creation:", error);
            document.getElementById('loading-text').textContent = `Error: ${error.message}. Please restart.`;
        }
    } else if (doc.exists) {
        // --- EXISTING USER FLOW ---
        userState = doc.data();
        if (!isInitialized) {
            isInitialized = true;
            setupAppForUser();
        }
        updateUI();
    }
}

function handleUserError(error) {
    console.error("Firestore listener failed:", error);
    document.getElementById('loading-text').textContent = 'Failed to connect to the database. Check security rules.';
}

function setupAppForUser() {
    console.log("Setting up UI and listeners.");
    db.collection('withdrawals').where('userId', '==', telegramUserId).orderBy('requestedAt', 'desc').limit(10).onSnapshot(updateWithdrawalHistory);
    setupTaskButtonListeners();
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
}

function updateUI() {
    if (!userState) return;

    const { balance = 0, tasksCompletedToday = 0, totalEarned = 0, totalAdsViewed = 0, totalRefers = 0, referralEarnings = 0, profilePicUrl, username, telegramUsername, joinedBonusTasks = [] } = userState;

    // Format numbers for display
    const format = (n) => Math.floor(n).toLocaleString();

    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => { if (profilePicUrl) img.src = profilePicUrl; });
    document.getElementById('balance-home').textContent = format(balance);
    document.getElementById('withdraw-balance').textContent = format(balance);
    document.getElementById('profile-balance').textContent = format(balance);
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
    
    document.getElementById('earned-so-far').textContent = format(totalEarned);
    document.getElementById('total-ads-viewed').textContent = format(totalAdsViewed);
    document.getElementById('total-refers').textContent = format(totalRefers);
    document.getElementById('refer-earnings').textContent = format(referralEarnings);
    document.getElementById('refer-count').textContent = format(totalRefers);
    document.getElementById('modal-refer-earnings').textContent = format(referralEarnings);

    joinedBonusTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });
}

async function openReferModal() {
    const linkInput = document.getElementById('referral-link');
    const copyButton = linkInput.nextElementSibling;
    
    linkInput.value = 'Generating...';
    copyButton.disabled = true;
    document.getElementById('refer-modal').style.display = 'flex';

    try {
        const generateReferralLink = functions.httpsCallable('generateReferralLink');
        const result = await generateReferralLink();
        if (result.data.success) {
            linkInput.value = result.data.link;
            copyButton.disabled = false;
        } else {
            throw new Error(result.data.error || "Failed to generate link.");
        }
    } catch (error) {
        console.error("Could not generate referral link:", error);
        linkInput.value = "Error. Please try again.";
    }
}

window.completeAdTask = async function() {
    if (!userState || userState.tasksCompletedToday >= DAILY_TASK_LIMIT) return;

    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = true;
    taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
    
    try {
        await window.show_9685198();
        const userRef = db.collection('users').doc(telegramUserId);
        // Backend function pays commission automatically when totalEarned is updated.
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
        alert("Ad could not be shown or was closed early. Please try again.");
    }
}

window.submitWithdrawal = async function() {
    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const walletId = document.getElementById('wallet-id').value.trim();
    if (isNaN(amount) || amount <= 0 || !walletId) { alert('Please enter a valid amount and wallet ID.'); return; }
    if (amount < WITHDRAWAL_MINIMUMS.binancepay) { alert(`Withdrawal failed. Minimum is ${WITHDRAWAL_MINIMUMS.binancepay.toLocaleString()} PEPE.`); return; }
    if (amount > userState.balance) { alert('Withdrawal failed. Insufficient balance.'); return; }

    try {
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
        alert(`Success! Your withdrawal request has been submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';
    } catch (error) {
        console.error("Withdrawal failed:", error);
        alert(`Error submitting request: ${error.message}`);
    }
}

function updateWithdrawalHistory(querySnapshot) {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = querySnapshot.empty ? '<p class="no-history">You have no withdrawal history yet.</p>' : '';
    querySnapshot.forEach(doc => {
        const w = doc.data();
        const date = w.requestedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        list.innerHTML += `<div class="history-item ${w.status}"><div class="history-details"><div class="history-amount">${w.amount.toLocaleString()} PEPE</div><div class="history-date">${date}</div></div><div class="history-status ${w.status}">${w.status}</div></div>`;
    });
}

// --- [UTILITY & OTHER FUNCTIONS] ---
function setupTaskButtonListeners() { document.querySelectorAll('.task-card').forEach(card => { const joinBtn = card.querySelector('.join-btn'); const verifyBtn = card.querySelector('.verify-btn'); const taskId = card.dataset.taskId; const url = card.dataset.url; const reward = parseInt(card.dataset.reward); if (joinBtn) { joinBtn.addEventListener('click', () => { handleJoinClick(taskId, url); }); } if (verifyBtn) { verifyBtn.addEventListener('click', () => { handleVerifyClick(taskId, reward); }); } }); }
async function handleVerifyClick(taskId, reward) { if (userState.joinedBonusTasks.includes(taskId)) { alert("Already completed."); return; } const verifyButton = document.querySelector(`#task-${taskId} .verify-btn`); verifyButton.disabled = true; verifyButton.textContent = "Verifying..."; try { await db.collection('users').doc(telegramUserId).update({ balance: firebase.firestore.FieldValue.increment(reward), totalEarned: firebase.firestore.FieldValue.increment(reward), joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId) }); alert(`Success! You earned ${reward} PEPE.`); } catch (error) { console.error("Verify task failed:", error); alert("An error occurred."); verifyButton.disabled = false; verifyButton.textContent = "Verify"; } }
function handleJoinClick(taskId, url) { const taskCard = document.getElementById(`task-${taskId}`); if (!taskCard) return; taskCard.querySelector('.verify-btn').disabled = false; taskCard.querySelector('.join-btn').disabled = true; window.open(url, '_blank'); alert("Return and press 'Verify' to claim your reward."); }
window.showTab = function(tabName, element) { document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); document.getElementById(tabName).classList.add('active'); document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active'); }
window.closeReferModal = function() { document.getElementById('refer-modal').style.display = 'none'; }
window.copyReferralLink = function(button) { const linkInput = document.getElementById('referral-link'); navigator.clipboard.writeText(linkInput.value).then(() => { const originalIcon = button.innerHTML; button.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { button.innerHTML = originalIcon; }, 1500); }); }
window.onclick = function(event) { if (event.target.classList.contains('modal-overlay')) { event.target.style.display = 'none'; } }

// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp) {
        Telegram.WebApp.ready();
        initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
    } else {
        document.getElementById('loading-text').textContent = 'Please run this app inside Telegram.';
    }
});
