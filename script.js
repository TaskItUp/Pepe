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
let unclaimedReferrals = []; // Store the actual referral documents
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
    db.collection('users').doc(telegramUserId).onSnapshot(handleUserSnapshot, handleUserError);
}

async function handleUserSnapshot(doc) {
    // If the app is already running, just update the state.
    if (isInitialized) {
        if (doc.exists) {
            userState = doc.data();
            updateUI();
        }
        return;
    }

    // This block runs only ONCE on the very first data received.
    if (doc.exists) {
        // CASE 1: The user is an EXISTING user.
        console.log("Existing user detected. Setting up app.");
        userState = doc.data();
        setupAppForUser(); // This shows the app and sets isInitialized to true.
        updateUI();
    } else {
        // CASE 2: The user is NEW.
        console.log("New user detected. Starting account creation process.");
        document.getElementById('loading-text').textContent = 'Finalizing account setup...';
        await processNewUser();
        // After this, the listener will fire again, and the app will enter CASE 1.
    }
}

/**
 * Creates a new user and leaves a "note" (unclaimedReferral doc) for the referrer.
 */
async function processNewUser() {
    const referrerId = telegramUser?.start_param;
    const newUserRef = db.collection('users').doc(telegramUserId);
    
    const newUserState = {
        username: `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || 'New User',
        telegramUsername: `@${telegramUser.username || telegramUserId}`,
        profilePicUrl: `https://i.pravatar.cc/150?u=${telegramUserId}`,
        balance: 0, tasksCompletedToday: 0, lastTaskTimestamp: null,
        totalEarned: 0, totalAdsViewed: 0, totalRefers: 0,
        joinedBonusTasks: [], referredBy: referrerId || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        // First, create the user document.
        await newUserRef.set(newUserState);
        console.log("New user document created.");

        // If they were referred, create the "note" for the referrer to find.
        if (referrerId) {
            await db.collection('unclaimedReferrals').add({
                referrerId: referrerId,
                newUserId: telegramUserId,
                newUserName: newUserState.username,
                status: 'unclaimed',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Unclaimed referral note created for referrer ${referrerId}.`);
        }
    } catch (error) {
        console.error("Error during new user processing:", error);
        document.getElementById('loading-text').textContent = "Error creating account.";
    }
}

function handleUserError(error) {
    console.error("Firestore listener failed:", error);
    document.getElementById('loading-text').textContent = 'Failed to connect to the database. Check security rules.';
}

/**
 * Sets up listeners and shows the main app content. Called only once.
 */
function setupAppForUser() {
    isInitialized = true; 
    console.log("Setting up UI and listeners for the first time.");
    db.collection('withdrawals').where('userId', '==', telegramUserId).orderBy('requestedAt', 'desc').limit(10).onSnapshot(updateWithdrawalHistory);
    // New listener to check for referrals to claim
    db.collection('unclaimedReferrals').where('referrerId', '==', telegramUserId).where('status', '==', 'unclaimed').onSnapshot(handleUnclaimedReferrals);
    setupTaskButtonListeners();
    document.getElementById('loading-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
}

/**
 * Handles showing the "Claim" button when new referrals are found.
 */
function handleUnclaimedReferrals(snapshot) {
    unclaimedReferrals = snapshot.docs; // Store the referral documents
    const claimSection = document.getElementById('claim-section');
    const claimText = document.getElementById('claim-text');
    const claimButton = document.getElementById('claim-button');

    if (unclaimedReferrals.length > 0) {
        claimText.textContent = `You have ${unclaimedReferrals.length} new referral(s)!`;
        claimSection.style.display = 'block';
        claimButton.disabled = false;
    } else {
        claimSection.style.display = 'none';
    }
}

/**
 * Called by the "Claim Now" button. Updates the user's own referral count.
 */
async function claimReferrals() {
    const claimButton = document.getElementById('claim-button');
    claimButton.disabled = true;
    claimButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Claiming...';
    
    const numToClaim = unclaimedReferrals.length;
    if (numToClaim === 0) return;

    try {
        // This transaction is secure because the user is only modifying their OWN data.
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection('users').doc(telegramUserId);
            // 1. Update the user's own totalRefers count.
            transaction.update(userRef, { totalRefers: firebase.firestore.FieldValue.increment(numToClaim) });

            // 2. Mark each referral note as "claimed".
            for (const doc of unclaimedReferrals) {
                transaction.update(doc.ref, { status: 'claimed' });
            }
        });
        alert(`Success! You have claimed ${numToClaim} referral(s).`);
        claimButton.innerHTML = '<i class="fas fa-gift"></i> Claim Now';
    } catch (error) {
        console.error("Failed to claim referrals:", error);
        alert("An error occurred while claiming. Please try again.");
        claimButton.disabled = false;
        claimButton.innerHTML = '<i class="fas fa-gift"></i> Claim Now';
    }
}


function updateUI() {
    if (!userState) return;

    const { balance = 0, tasksCompletedToday = 0, totalEarned = 0, totalAdsViewed = 0, totalRefers = 0, profilePicUrl, username, telegramUsername, joinedBonusTasks = [] } = userState;
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
    document.getElementById('refer-count').textContent = format(totalRefers);

    document.querySelectorAll('.task-card').forEach(card => card.classList.remove('completed'));
    joinedBonusTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });
}

function openReferModal() {
    const linkInput = document.getElementById('referral-link');
    // The link is now permanent and doesn't need to be generated.
    linkInput.value = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    document.getElementById('refer-modal').style.display = 'flex';
}

window.completeAdTask = async function() {
    if (!userState || userState.tasksCompletedToday >= DAILY_TASK_LIMIT) return;
    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = true;
    taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
    try {
        await window.show_9685198();
        await db.collection('users').doc(telegramUserId).update({
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
function setupTaskButtonListeners() { document.querySelectorAll('.task-card').forEach(card => { const joinBtn = card.querySelector('.join-btn'); const verifyBtn = card.querySelector('.verify-btn'); const taskId = card.dataset.taskId; const url = card.dataset.url; const reward = parseInt(card.dataset.reward); if (joinBtn) { joinBtn.addEventListener('click', () => handleJoinClick(taskId, url)); } if (verifyBtn) { verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward)); } }); }
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
