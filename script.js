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
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- [CORE APP LOGIC] ---
function initializeApp(tgUser) {
telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();

console.log(`Initializing app for User ID: ${telegramUserId}`);

// ✅ Always check ?ref= in the URL for referral
let referrerId = new URLSearchParams(window.location.search).get('ref');

// Prevent self-referral
if (referrerId && referrerId === telegramUserId) {
referrerId = null;
}

const userRef = db.collection('users').doc(telegramUserId);

// Real-time updates
userRef.onSnapshot(async (doc) => {
if (!doc.exists) {
console.log('New user detected. Creating account...');

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

// ✅ Credit referrer instantly
if (referrerId) {
const referrerRef = db.collection('users').doc(referrerId);
try {
await db.runTransaction(async (transaction) => {
const referrerDoc = await transaction.get(referrerRef);
if (!referrerDoc.exists) throw "Referrer not found!";
transaction.update(referrerRef, {
totalRefers: firebase.firestore.FieldValue.increment(1)
});
transaction.set(userRef, newUserState);
});
} catch (error) {
console.error("Referral transaction failed, creating user normally.", error);
await userRef.set(newUserState);
}
} else {
await userRef.set(newUserState);
}
} else {
console.log('User data updated in real-time.');
userState = doc.data();
}

if (!isInitialized) {
setupTaskButtonListeners();
listenForWithdrawalHistory();
isInitialized = true;
}
updateUI();
}, (error) => console.error("Error listening to user document:", error));
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

function updateUI() {
const balanceString = Math.floor(userState.balance || 0).toLocaleString();
const totalEarnedString = Math.floor(userState.totalEarned || 0).toLocaleString();
const referralEarningsString = (userState.referralEarnings || 0).toLocaleString();
const totalRefersString = (userState.totalRefers || 0).toLocaleString();

document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => { if (userState.profilePicUrl) img.src = userState.profilePicUrl; });
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
const progressPercentage = (tasksCompleted / DAILY_TASK_LIMIT) * 100;
document.getElementById('task-progress-bar').style.width = `${progressPercentage}%`;
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
const withdrawal = doc.data();
const itemElement = renderHistoryItem(withdrawal);
historyList.appendChild(itemElement);
});
});
}

// Commission payment
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

// --- [UI FUNCTIONS] ---
window.openReferModal = function() {
if (!TELEGRAM_BOT_USERNAME) {
alert("Error: Bot username not set.");
return;
}
const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
document.getElementById('referral-link').value = referralLink;
document.getElementById('refer-modal').style.display = 'flex';
}
window.closeReferModal = function() { document.getElementById('refer-modal').style.display = 'none'; }
window.copyReferralLink = function(button) {
const linkInput = document.getElementById('referral-link');
navigator.clipboard.writeText(linkInput.value).then(() => {
const originalIcon = button.innerHTML;
button.innerHTML = '<i class="fas fa-check"></i>';
setTimeout(() => { button.innerHTML = originalIcon; }, 1500);
}).catch(err => console.error('Failed to copy text: ', err));
}

// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
if (window.Telegram && window.Telegram.WebApp) {
Telegram.WebApp.ready();
initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
} else {
console.warn("Telegram script not found. Running in browser test mode.");
initializeApp(null);
}
});
