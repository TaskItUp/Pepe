// --- [DATABASE & APP INITIALIZATION] ---

// YOUR PERSONAL FIREBASE CONFIGURATION
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
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = {
    binancepay: 10000
};

// --- [CORE APP LOGIC] ---

/**
 * Initializes the application, handles user creation for new users (including referral tracking),
 * and sets up real-time data listeners.
 * @param {object} tgUser - The user object from Telegram.WebApp.initDataUnsafe.
 */
function initializeApp(tgUser) {
    // Use the real Telegram User ID or a fake one for browser testing
    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
    
    console.log(`Initializing app for User ID: ${telegramUserId}`);
    const userRef = db.collection('users').doc(telegramUserId);

    // Listen for real-time updates to the user's data
    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            // --- NEW USER CREATION PATH ---
            console.log('New user detected. Full Telegram data:', window.Telegram.WebApp.initDataUnsafe);
            
            // The 'start_param' from Telegram is the most reliable way to get the referrer's ID. [3, 5, 13]
            const referrerId = tgUser?.start_param;
            console.log(`Parsed referrerId from start_param: '${referrerId}'`);

            const newUserState = {
                username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "Test User",
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
            
            // Set the local userState immediately. This is crucial for the referral system to work instantly.
            userState = newUserState;

            if (referrerId) {
                console.log(`Referrer ID [${referrerId}] found. Starting transactional write.`);
                const referrerRef = db.collection('users').doc(referrerId);
                try {
                    // Use a Firestore transaction to ensure the referrer is credited atomically. [1]
                    await db.runTransaction(async (transaction) => {
                        const referrerDoc = await transaction.get(referrerRef);
                        if (!referrerDoc.exists) {
                            console.warn(`Referrer [${referrerId}] not found. Creating new user without referral credit.`);
                            newUserState.referredBy = null; // Clear the invalid referrer ID
                            transaction.set(userRef, newUserState);
                        } else {
                            console.log(`Referrer [${referrerId}] found. Incrementing their totalRefers.`);
                            // Atomically increment the referrer's count.
                            transaction.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1) 
                            });
                            // Create the new user's document.
                            transaction.set(userRef, newUserState);
                        }
                    });
                    console.log("SUCCESS: Referral transaction completed.");
                } catch (error) {
                    console.error("FATAL: Referral transaction failed. The referrer was NOT credited.", error);
                    // Fallback: create the user anyway, but without referral data.
                    newUserState.referredBy = null; 
                    await userRef.set(newUserState);
                }
            } else {
                console.log("No referrer ID found. Creating a standard new user.");
                await userRef.set(newUserState);
            }
        } else {
            // --- EXISTING USER PATH ---
            console.log('Existing user data updated in real-time.');
            userState = doc.data();
        }
        
        // Run initial setup only once
        if (!isInitialized) {
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            isInitialized = true;
        }
        // Update the UI with the latest data
        updateUI();

    }, (error) => console.error("Error listening to user document:", error));
}

/**
 * Generates a consistent placeholder avatar URL based on the user's ID.
 * @param {string} userId - The user's ID.
 * @returns {string} The URL for the placeholder image.
 */
function generatePlaceholderAvatar(userId) {
    return `https://i.pravatar.cc/150?u=${userId}`;
}

/**
 * Creates a fake user ID for testing in a regular web browser.
 * @returns {string} A locally stored or newly generated user ID.
 */
function getFakeUserIdForTesting() {
    let storedId = localStorage.getItem('localAppUserId');
    if (storedId) return storedId;
    const newId = 'test_user_' + Date.now().toString(36);
    localStorage.setItem('localAppUserId', newId);
    return newId;
}

/**
 * Updates all relevant parts of the UI with the current userState.
 */
function updateUI() {
    if (!userState) return;
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
    
    // Update bonus task UI
    const joinedTasks = userState.joinedBonusTasks || [];
    joinedTasks.forEach(taskId => {
        const taskCard = document.getElementById(`task-${taskId}`);
        if (taskCard) taskCard.classList.add('completed');
    });
}


/**
 * Pays a 10% commission to the user's referrer.
 * This function is called after a user successfully completes a rewarded task.
 * @param {number} earnedAmount - The amount the current user earned from the task.
 */
async function payReferralCommission(earnedAmount) {
    // Exit if the user wasn't referred by anyone
    if (!userState.referredBy) {
        return;
    }

    const commissionAmount = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
    if (commissionAmount <= 0) {
        return; // No commission to pay
    }

    const referrerRef = db.collection('users').doc(userState.referredBy);
    
    // Atomically increment the referrer's balance and referral earnings. [10]
    return referrerRef.update({
        balance: firebase.firestore.FieldValue.increment(commissionAmount),
        referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount)
    }).catch(error => console.error("Failed to pay commission to referrer:", error));
}


// --- [TASK & WITHDRAWAL LOGIC] ---

/**
 * Handles the completion of an ad-watching task.
 */
window.completeAdTask = async function() {
    if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
        alert("You have completed all ad tasks for today!");
        return;
    }
    const taskButton = document.getElementById('start-task-button');
    try {
        taskButton.disabled = true;
        taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
        
        await window.show_9685198(); // The external ad SDK function

        const userRef = db.collection('users').doc(telegramUserId);
        
        // Update the current user's stats
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Pay commission to the referrer
        await payReferralCommission(AD_REWARD);

        alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
    } catch (error) {
        console.error("An error occurred during the ad task:", error);
        alert("Ad could not be shown or was closed early. Please try again.");
    } finally {
        updateUI(); // Refresh UI to reflect changes
    }
}

/**
 * Handles clicks on the "Join" button for bonus tasks.
 * @param {string} taskId - The ID of the task.
 * @param {string} url - The URL to open.
 */
function handleJoinClick(taskId, url) {
    const taskCard = document.getElementById(`task-${taskId}`);
    if (!taskCard) return;
    const joinButton = taskCard.querySelector('.join-btn');
    const verifyButton = taskCard.querySelector('.verify-btn');
    window.open(url, '_blank');
    alert("After joining, return to the app and press 'Verify' to claim your reward.");
    if (verifyButton) verifyButton.disabled = false;
    if (joinButton) joinButton.disabled = true;
}

/**
 * Handles clicks on the "Verify" button for bonus tasks.
 * @param {string} taskId - The ID of the task.
 * @param {number} reward - The reward amount for the task.
 */
async function handleVerifyClick(taskId, reward) {
    if (userState.joinedBonusTasks && userState.joinedBonusTasks.includes(taskId)) {
        alert("You have already completed this task.");
        return;
    }
    const taskCard = document.getElementById(`task-${taskId}`);
    const verifyButton = taskCard.querySelector('.verify-btn');
    verifyButton.disabled = true;
    verifyButton.textContent = "Verifying...";
    try {
        const userRef = db.collection('users').doc(telegramUserId);
        // Update user's data for the bonus task
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(reward),
            totalEarned: firebase.firestore.FieldValue.increment(reward),
            joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
        });
        
        // Pay commission for the bonus task as well
        await payReferralCommission(reward);

        alert(`Verification successful! You've earned ${reward} PEPE.`);
    } catch (error) {
        console.error("Error rewarding user for channel join:", error);
        alert("An error occurred. Please try again.");
        verifyButton.disabled = false;
        verifyButton.textContent = "Verify";
    }
}

/**
 * Submits a withdrawal request.
 */
window.submitWithdrawal = async function() {
    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const method = document.getElementById('withdraw-method').value;
    const walletId = document.getElementById('wallet-id').value.trim();
    const minAmount = WITHDRAWAL_MINIMUMS[method];

    if (isNaN(amount) || amount <= 0 || !walletId) {
        alert('Please enter a valid amount and your Binance ID or Email.');
        return;
    }
    if (amount < minAmount) {
        alert(`Withdrawal failed. The minimum is ${minAmount.toLocaleString()} PEPE.`);
        return;
    }
    if (amount > userState.balance) {
        alert('Withdrawal failed. You do not have enough balance.');
        return;
    }

    try {
        // Optimistically update the UI
        const historyList = document.getElementById('history-list');
        const noHistoryMsg = historyList.querySelector('.no-history');
        if (noHistoryMsg) noHistoryMsg.remove();
        const optimisticData = { amount, status: 'pending', requestedAt: new Date() };
        const optimisticItem = renderHistoryItem(optimisticData);
        historyList.prepend(optimisticItem);

        // Add withdrawal request to the database
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

        // Deduct the balance from the user's account
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(-amount)
        });

        alert(`Success! Your withdrawal request for ${amount.toLocaleString()} PEPE has been submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';
    } catch (error) {
        console.error("Withdrawal failed:", error);
        alert("There was an error submitting your request. Please try again.");
    }
}


// --- [UI & EVENT LISTENERS] ---

/**
 * Sets up event listeners for the bonus task buttons.
 */
function setupTaskButtonListeners() {
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward, 10);

        if (joinBtn) {
            joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
        }
        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
        }
    });
}

/**
 * Listens for and displays the user's withdrawal history.
 */
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

/**
 * Renders a single withdrawal history item.
 * @param {object} withdrawalData - The data for a single withdrawal.
 * @returns {HTMLElement} The rendered HTML element.
 */
function renderHistoryItem(withdrawalData) {
    const item = document.createElement('div');
    item.className = `history-item ${withdrawalData.status}`;
    const date = withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : new Date(withdrawalData.requestedAt);
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    item.innerHTML = `
        <div class="history-details">
            <div class="history-amount">${withdrawalData.amount.toLocaleString()} PEPE</div>
            <div class="history-date">${formattedDate}</div>
        </div>
        <div class="history-status ${withdrawalData.status}">
            ${withdrawalData.status}
        </div>
    `;
    return item;
}

// --- [UTILITY FUNCTIONS] ---
window.showTab = function(tabName, element) { document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); document.getElementById(tabName).classList.add('active'); document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active'); }
window.openReferModal = function() { if (!TELEGRAM_BOT_USERNAME) { alert("Error: Bot username not set."); return; } const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`; document.getElementById('referral-link').value = referralLink; document.getElementById('refer-modal').style.display = 'flex'; }
window.closeReferModal = function() { document.getElementById('refer-modal').style.display = 'none'; }
window.copyReferralLink = function(button) { const linkInput = document.getElementById('referral-link'); navigator.clipboard.writeText(linkInput.value).then(() => { const originalIcon = button.innerHTML; button.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { button.innerHTML = originalIcon; }, 1500); }).catch(err => console.error('Failed to copy text: ', err)); }
window.onclick = function(event) { if (event.target == document.getElementById('refer-modal')) { closeReferModal(); } }


// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if the script is running inside a Telegram Mini App
    if (window.Telegram && window.Telegram.WebApp) {
        console.log("Telegram WebApp script found. Initializing...");
        Telegram.WebApp.ready();
        // Pass the Telegram user object to the initialization function
        initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
    } else {
        console.warn("Telegram WebApp script not found. Running in browser test mode.");
        // Fallback for local testing without Telegram environment
        initializeApp(null); 
    }
});
