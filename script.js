// --- [DATABASE & APP INITIALIZATION] ---

// YOUR PERSONAL FIREBASE CONFIGURATION IS NOW INCLUDED
const firebaseConfig = {
  apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
  authDomain: "taskup-9ba7b.firebaseapp.com",
  projectId: "taskup-9ba7b",
  storageBucket: "taskup-9ba7b.appspot.com",
  messagingSenderId: "319481101196",
  appId: "1:319481101196:web:6cded5be97620d98d974a9",
  measurementId: "G-JNNLG1E49L"
};

// Initialize Firebase using the compat libraries
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- [GLOBAL STATE & CONSTANTS] ---
let userState = {};
let localUserId = null;

// !!! IMPORTANT: REPLACE THIS WITH YOUR ACTUAL BOT USERNAME !!!
const TELEGRAM_BOT_USERNAME = "TaskItUpBot"; // e.g., "MyPepeCoinBot"

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = {
    binancepay: 10000 
};

// --- [CORE APP LOGIC WITH REFERRAL TRACKING] ---

async function initializeApp() {
    localUserId = getLocalUserId();
    let referrerId = null;

    // NEW: Check for the referral code directly from the Telegram launch parameters
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
        // This is the referral code passed by the bot's "start" parameter
        referrerId = window.Telegram.WebApp.initDataUnsafe.start_param || null;
        if (referrerId) {
            console.log(`Referral code found from Telegram start_param: ${referrerId}`);
        }
    }
    
    // Fallback for browser testing
    if (!referrerId) {
        const params = new URLSearchParams(window.location.search);
        referrerId = params.get('ref') || null;
        if (referrerId) {
            console.log(`Referral code found from URL (?ref=...): ${referrerId}`);
        }
    }

    const userRef = db.collection('users').doc(localUserId);
    const doc = await userRef.get();

    if (!doc.exists) {
        console.log('New user detected. Creating default account...');
        const newUserState = {
            username: "User",
            telegramUsername: `@user_${localUserId.substring(0,6)}`,
            profilePicUrl: generatePlaceholderAvatar(localUserId),
            balance: 0, tasksCompletedToday: 0, lastTaskTimestamp: null,
            totalEarned: 0, totalAdsViewed: 0, totalRefers: 0, joinedBonusTasks: [],
            referredBy: referrerId, // Store the referrer's ID
            referralEarnings: 0
        };
        await userRef.set(newUserState);
        userState = newUserState;
    } else {
        console.log('Returning user. Loading data from Firebase...');
        userState = doc.data();
        if (userState.lastTaskTimestamp) {
            const now = new Date();
            const lastTaskDate = userState.lastTaskTimestamp.toDate();
            if (now.getUTCDate() > lastTaskDate.getUTCDate() || now.getUTCMonth() > lastTaskDate.getUTCMonth()) {
                userState.tasksCompletedToday = 0;
                await userRef.update({ tasksCompletedToday: 0 });
            }
        }
    }
    setupTaskButtonListeners();
    listenForWithdrawalHistory();
    updateUI();
}

function getLocalUserId() { let storedId = localStorage.getItem('localAppUserId'); if (storedId) return storedId; const newId = 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2); localStorage.setItem('localAppUserId', newId); return newId; }
function generatePlaceholderAvatar(userId) { return `https://i.pravatar.cc/150?u=${userId}`; }

function updateUI() {
    const balanceString = Math.floor(userState.balance).toLocaleString();
    const totalEarnedString = Math.floor(userState.totalEarned).toLocaleString();
    const referralEarningsString = (userState.referralEarnings || 0).toLocaleString();
    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => { if (userState.profilePicUrl) img.src = userState.profilePicUrl; });
    document.getElementById('balance-home').textContent = balanceString;
    document.getElementById('withdraw-balance').textContent = balanceString;
    document.getElementById('profile-balance').textContent = balanceString;
    document.getElementById('home-username').textContent = userState.username;
    document.getElementById('profile-name').textContent = userState.username;
    document.getElementById('telegram-username').textContent = userState.telegramUsername;
    document.getElementById('ads-watched-today').textContent = userState.tasksCompletedToday;
    document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - userState.tasksCompletedToday;
    const tasksCompleted = userState.tasksCompletedToday;
    document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    const progressPercentage = (tasksCompleted / DAILY_TASK_LIMIT) * 100;
    document.getElementById('task-progress-bar').style.width = `${progressPercentage}%`;
    const taskButton = document.getElementById('start-task-button');
    taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
    taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';
    document.getElementById('earned-so-far').textContent = totalEarnedString;
    document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed;
    document.getElementById('total-refers').textContent = userState.totalRefers;
    document.getElementById('refer-earnings').textContent = referralEarningsString;
    userState.joinedBonusTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });
}

// --- REAL-TIME HISTORY LISTENER ---
function listenForWithdrawalHistory() {
    const historyList = document.getElementById('history-list');
    db.collection('withdrawals').where('userId', '==', localUserId).orderBy('requestedAt', 'desc').limit(10)
      .onSnapshot(querySnapshot => {
          if (querySnapshot.empty) {
              historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
              return;
          }
          historyList.innerHTML = '';
          querySnapshot.forEach(doc => {
              const withdrawal = doc.data();
              const item = document.createElement('div');
              item.className = `history-item ${withdrawal.status}`;
              const date = withdrawal.requestedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              item.innerHTML = `
                  <div class="history-details">
                      <div class="history-amount">${withdrawal.amount.toLocaleString()} PEPE</div>
                      <div class="history-date">${date}</div>
                  </div>
                  <div class="history-status ${withdrawal.status}">
                      ${withdrawal.status}
                  </div>
              `;
              historyList.appendChild(item);
          });
      });
}

async function payReferralCommission(earnedAmount) { if (!userState.referredBy) return; const commissionAmount = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE); if (commissionAmount > 0) { const referrerRef = db.collection('users').doc(userState.referredBy); await referrerRef.update({ balance: firebase.firestore.FieldValue.increment(commissionAmount), referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount) }).catch(error => console.error("Failed to pay commission:", error)); } }
function setupTaskButtonListeners() { document.querySelectorAll('.task-card').forEach(card => { const joinBtn = card.querySelector('.join-btn'); const verifyBtn = card.querySelector('.verify-btn'); const taskId = card.dataset.taskId; const url = card.dataset.url; const reward = parseInt(card.dataset.reward); if (joinBtn) { joinBtn.addEventListener('click', () => { handleJoinClick(taskId, url); }); } if (verifyBtn) { verifyBtn.addEventListener('click', () => { handleVerifyClick(taskId, reward); }); } }); }
function handleJoinClick(taskId, url) { const taskCard = document.getElementById(`task-${taskId}`); if (!taskCard) return; const joinButton = taskCard.querySelector('.join-btn'); const verifyButton = taskCard.querySelector('.verify-btn'); window.open(url, '_blank'); alert("After joining, return to the app and press 'Verify' to claim your reward."); if (verifyButton) verifyButton.disabled = false; if (joinButton) joinButton.disabled = true; }
async function handleVerifyClick(taskId, reward) { if (userState.joinedBonusTasks.includes(taskId)) { alert("You have already completed this task."); return; } const taskCard = document.getElementById(`task-${taskId}`); const verifyButton = taskCard.querySelector('.verify-btn'); verifyButton.disabled = true; verifyButton.textContent = "Verifying..."; try { const userRef = db.collection('users').doc(localUserId); await userRef.update({ balance: firebase.firestore.FieldValue.increment(reward), totalEarned: firebase.firestore.FieldValue.increment(reward), joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId) }); userState.balance += reward; userState.totalEarned += reward; userState.joinedBonusTasks.push(taskId); await payReferralCommission(reward); alert(`Verification successful! You've earned ${reward} PEPE.`); updateUI(); } catch (error) { console.error("Error rewarding user for channel join:", error); alert("An error occurred. Please try again."); verifyButton.disabled = false; verifyButton.textContent = "Verify"; } }

window.completeAdTask = async function() { if (userState.tasksCompletedToday >= DAILY_TASK_LIMIT) { alert("You have completed all ad tasks for today!"); return; } const taskButton = document.getElementById('start-task-button'); try { taskButton.disabled = true; taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...'; await window.show_9685198(); const userRef = db.collection('users').doc(localUserId); await userRef.update({ balance: firebase.firestore.FieldValue.increment(AD_REWARD), totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD), tasksCompletedToday: firebase.firestore.FieldValue.increment(1), totalAdsViewed: firebase.firestore.FieldValue.increment(1), lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp() }); userState.balance += AD_REWARD; userState.totalEarned += AD_REWARD; userState.tasksCompletedToday++; userState.totalAdsViewed++; await payReferralCommission(AD_REWARD); alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`); } catch (error) { console.error("An error occurred during the ad task:", error); alert("Ad could not be shown or was closed early. Please try again."); } finally { updateUI(); } }
window.submitWithdrawal = async function() { const amount = parseInt(document.getElementById('withdraw-amount').value); const method = document.getElementById('withdraw-method').value; const walletId = document.getElementById('wallet-id').value.trim(); const minAmount = WITHDRAWAL_MINIMUMS[method]; if (isNaN(amount) || amount <= 0 || !walletId) { alert('Please enter a valid amount and your Binance ID or Email.'); return; } if (amount < minAmount) { alert(`Withdrawal failed. The minimum is ${minAmount.toLocaleString()} PEPE.`); return; } if (amount > userState.balance) { alert('Withdrawal failed. You do not have enough balance.'); return; } const historyList = document.getElementById('history-list'); const noHistoryMsg = historyList.querySelector('.no-history'); if (noHistoryMsg) { noHistoryMsg.remove(); } const optimisticData = { amount: amount, status: 'pending', requestedAt: new Date() }; const optimisticItem = renderHistoryItem(optimisticData); historyList.prepend(optimisticItem); await db.collection('withdrawals').add({ userId: localUserId, username: userState.telegramUsername, amount: amount, method: "Binance Pay", walletId: walletId, currency: "PEPE", status: "pending", requestedAt: firebase.firestore.FieldValue.serverTimestamp() }); const userRef = db.collection('users').doc(localUserId); await userRef.update({ balance: firebase.firestore.FieldValue.increment(-amount) }); alert(`Success! Your withdrawal request for ${amount.toLocaleString()} PEPE has been submitted.`); userState.balance -= amount; document.getElementById('withdraw-amount').value = ''; document.getElementById('wallet-id').value = ''; updateUI(); }

// --- [UTILITY & REFERRAL MODAL FUNCTIONS] ---
window.showTab = function(tabName, element) { document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); document.getElementById(tabName).classList.add('active'); document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active'); }

window.openReferModal = function() {
    // MODIFIED: Generate the direct Telegram bot link
    if (!TELEGRAM_BOT_USERNAME || TELEGRAM_BOT_USERNAME === "YourActualBotUsername") {
        alert("Error: The bot username has not been set in the script.js file.");
        return;
    }
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${localUserId}`;
    document.getElementById('referral-link').value = referralLink;
    document.getElementById('refer-modal').style.display = 'flex';
}

window.closeReferModal = function() { document.getElementById('refer-modal').style.display = 'none'; }
window.copyReferralLink = function(button) { const linkInput = document.getElementById('referral-link'); navigator.clipboard.writeText(linkInput.value).then(() => { const originalIcon = button.innerHTML; button.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { button.innerHTML = originalIcon; }, 1500); }).catch(err => console.error('Failed to copy text: ', err)); }
window.onclick = function(event) { if (event.target == document.getElementById('refer-modal')) { closeReferModal(); } }
function renderHistoryItem(withdrawalData) { const item = document.createElement('div'); item.className = `history-item ${withdrawalData.status}`; const date = withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : withdrawalData.requestedAt; const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); item.innerHTML = ` <div class="history-details"> <div class="history-amount">${withdrawalData.amount.toLocaleString()} PEPE</div> <div class="history-date">${formattedDate}</div> </div> <div class="history-status ${withdrawalData.status}"> ${withdrawalData.status} </div> `; return item; }

// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});
