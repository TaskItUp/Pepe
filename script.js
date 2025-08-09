

// --- [GLOBAL STATE & CONSTANTS] ---
let userState = {};
let telegramUserId = null;
let isInitialized = false;
const TELEGRAM_BOT_USERNAME = "TaskItUpBot";

const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const WITHDRAWAL_MINIMUMS = {
    binancepay: 10000
};

// --- [CORE APP LOGIC - BACKEND CONNECTED] ---

/**
 * Initializes the application by sending user data to the backend.
 * The backend will either create a new user (and process referrals) or fetch existing data.
 * @param {object} tgUser - The Telegram user object from the web app.
 */
async function initializeApp(tgUser) {
    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
    console.log(`Initializing app for User ID: ${telegramUserId}`);

    const initializationData = {
        userId: telegramUserId,
        referrerId: tgUser?.start_param || null,
        userInfo: {
            username: tgUser ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() : "User",
            telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`
        }
    };

    try {
        const response = await fetch(`${BACKEND_URL}/initialize_user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initializationData)
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        userState = await response.json();
        console.log('User state received from backend:', userState);

        if (!isInitialized) {
            setupTaskButtonListeners();
            fetchWithdrawalHistory();
            isInitialized = true;
        }
        updateUI();

    } catch (error) {
        console.error("Fatal: Could not initialize user with the backend.", error);
        alert("There was a problem connecting to the server. Please check your internet connection and try again later.");
        document.body.innerHTML = `<div style="text-align: center; padding-top: 50px; font-family: 'Poppins', sans-serif;"><h2>Connection Error</h2><p>Could not connect to the server. Please restart the app.</p></div>`;
    }
}

/**
 * Handles the completion of an ad task. It shows the ad and then notifies the backend.
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

        // 1. Show the ad to the user
        await window.show_9685198();

        // 2. Notify the backend that the ad was completed successfully
        const response = await fetch(`${BACKEND_URL}/complete_ad_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: telegramUserId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to get reward from server.');

        // 3. Update local state and UI with the reward from the backend
        userState.balance += result.reward;
        userState.totalEarned += result.reward;
        userState.tasksCompletedToday += 1;
        userState.totalAdsViewed += 1;
        alert(`Success! ${result.reward} PEPE has been added to your balance.`);

    } catch (error) {
        console.error("An error occurred during the ad task:", error);
        alert("Ad could not be shown or was closed early. No reward was given. Please try again.");
    } finally {
        updateUI(); // Update UI to reflect new balance and task count
    }
}

/**
 * Handles the verification of a bonus task (e.g., joining a channel).
 * @param {string} taskId - The unique ID of the task.
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
        const response = await fetch(`${BACKEND_URL}/verify_bonus_task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: telegramUserId, taskId, reward })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        // Update local state and UI
        userState.balance += result.reward;
        userState.totalEarned += result.reward;
        userState.joinedBonusTasks.push(taskId);
        updateUI();
        alert(`Verification successful! You've earned ${result.reward} PEPE.`);

    } catch (error) {
        console.error("Error rewarding user for channel join:", error);
        alert(`An error occurred: ${error.message}. Please try again.`);
        verifyButton.disabled = false;
        verifyButton.textContent = "Verify";
    }
}

/**
 * Submits a withdrawal request to the backend.
 */
window.submitWithdrawal = async function() {
    const amount = parseInt(document.getElementById('withdraw-amount').value);
    const walletId = document.getElementById('wallet-id').value.trim();
    const minAmount = WITHDRAWAL_MINIMUMS['binancepay'];

    // Client-side validation first
    if (isNaN(amount) || amount <= 0 || !walletId) { alert('Please enter a valid amount and your Binance ID or Email.'); return; }
    if (amount < minAmount) { alert(`Withdrawal failed. The minimum is ${minAmount.toLocaleString()} PEPE.`); return; }
    if (amount > userState.balance) { alert('Withdrawal failed. You do not have enough balance.'); return; }

    try {
        const response = await fetch(`${BACKEND_URL}/submit_withdrawal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: telegramUserId, amount, walletId })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        // Update local state and UI upon success
        userState.balance -= amount;
        updateUI();
        fetchWithdrawalHistory(); // Refresh the history list immediately

        alert(`Success! Your withdrawal request for ${amount.toLocaleString()} PEPE has been submitted.`);
        document.getElementById('withdraw-amount').value = '';
        document.getElementById('wallet-id').value = '';

    } catch (error) {
        console.error("Withdrawal failed:", error);
        alert(`Withdrawal failed: ${error.message}. Please try again.`);
    }
}


// --- [UI & UTILITY FUNCTIONS] ---

/**
 * Fetches the user's withdrawal history from the backend.
 */
async function fetchWithdrawalHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '<p class="no-history">Loading history...</p>'; // Show loading state
    try {
        const response = await fetch(`${BACKEND_URL}/get_withdrawal_history?userId=${telegramUserId}`);
        const history = await response.json();
        if (!response.ok) throw new Error(history.error);

        if (history.length === 0) {
            historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
            return;
        }

        historyList.innerHTML = '';
        history.forEach(withdrawal => {
            const itemData = { ...withdrawal, requestedAt: new Date(withdrawal.requestedAt) };
            const itemElement = renderHistoryItem(itemData);
            historyList.appendChild(itemElement);
        });
    } catch (error) {
        console.error("Could not fetch withdrawal history:", error);
        historyList.innerHTML = '<p class="no-history" style="color: red;">Could not load history.</p>';
    }
}

/**
 * Updates all relevant UI elements with the current userState.
 */
function updateUI() {
    if (!userState || Object.keys(userState).length === 0) return;

    const balanceString = Math.floor(userState.balance || 0).toLocaleString();
    const totalEarnedString = Math.floor(userState.totalEarned || 0).toLocaleString();
    const referralEarningsString = (userState.referralEarnings || 0).toLocaleString();
    const totalRefersString = (userState.totalRefers || 0).toLocaleString();

    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => { if (userState.profilePicUrl) img.src = userState.profilePicUrl; });
    document.getElementById('balance-home').textContent = balanceString;
    document.getElementById('withdraw-balance').textContent = balanceString;
    document.getElementById('profile-balance').textContent = balanceString;
    document.getElementById('home-username').textContent = userState.username || "User";
    document.getElementById('profile-name').textContent = userState.username || "User";
    document.getElementById('telegram-username').textContent = userState.telegramUsername || "@username";
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

function renderHistoryItem(withdrawalData) { const item = document.createElement('div'); item.className = `history-item ${withdrawalData.status}`; const date = withdrawalData.requestedAt; const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); item.innerHTML = ` <div class="history-details"> <div class="history-amount">${withdrawalData.amount.toLocaleString()} PEPE</div> <div class="history-date">${formattedDate}</div> </div> <div class="history-status ${withdrawalData.status}"> ${withdrawalData.status} </div> `; return item; }
function getFakeUserIdForTesting() { let storedId = localStorage.getItem('localAppUserId'); if (storedId) return storedId; const newId = 'test_user_' + Date.now().toString(36); localStorage.setItem('localAppUserId', newId); return newId; }

function setupTaskButtonListeners() { document.querySelectorAll('.task-card').forEach(card => { const joinBtn = card.querySelector('.join-btn'); const verifyBtn = card.querySelector('.verify-btn'); const taskId = card.dataset.taskId; const url = card.dataset.url; const reward = parseInt(card.dataset.reward); if (joinBtn) { joinBtn.addEventListener('click', () => { handleJoinClick(taskId, url); }); } if (verifyBtn) { verifyBtn.addEventListener('click', () => { handleVerifyClick(taskId, reward); }); } }); }
function handleJoinClick(taskId, url) { const taskCard = document.getElementById(`task-${taskId}`); if (!taskCard) return; const joinButton = taskCard.querySelector('.join-btn'); const verifyButton = taskCard.querySelector('.verify-btn'); window.open(url, '_blank'); alert("After joining, return to the app and press 'Verify' to claim your reward."); if (verifyButton) verifyButton.disabled = false; if (joinButton) joinButton.disabled = true; }

window.showTab = function(tabName, element) { document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); document.getElementById(tabName).classList.add('active'); document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active'); }
window.openReferModal = function() { if (!TELEGRAM_BOT_USERNAME) { alert("Error: Bot username not set."); return; } const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`; document.getElementById('referral-link').value = referralLink; document.getElementById('refer-modal').style.display = 'flex'; }
window.closeReferModal = function() { document.getElementById('refer-modal').style.display = 'none'; }
window.copyReferralLink = function(button) { const linkInput = document.getElementById('referral-link'); navigator.clipboard.writeText(linkInput.value).then(() => { const originalIcon = button.innerHTML; button.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { button.innerHTML = originalIcon; }, 1500); }).catch(err => console.error('Failed to copy text: ', err)); }
window.onclick = function(event) { if (event.target == document.getElementById('refer-modal')) { closeReferModal(); } }


// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
        Telegram.WebApp.ready();
        initializeApp(window.Telegram.WebApp.initDataUnsafe.user);
    } else {
        console.warn("Telegram script not found. Running in browser test mode.");
        initializeApp(null); // Fallback for local testing
    }
});

