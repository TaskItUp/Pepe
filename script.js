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

// Initialize Firebase
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

async function initializeApp(tgUser) {
    // Get Telegram user ID or create test ID
    telegramUserId = tgUser ? tgUser.id.toString() : 'test_user_' + Date.now().toString(36);
    
    console.log(`Initializing app for User ID: ${telegramUserId}`);
    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            // New user registration with referral tracking
            console.log('New user detected. Telegram data:', tgUser);
            
            // Get referrer ID from Telegram start_param
            const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
            const referrerId = startParam || null;
            console.log(`Referrer ID from start_param: '${referrerId}'`);

            const newUserState = {
                username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || `User${Date.now().toString().slice(-4)}` : "TestUser",
                telegramUsername: tgUser ? `@${tgUser.username || tgUser.id}` : `@test_user`,
                telegramId: telegramUserId,
                profilePicUrl: generatePlaceholderAvatar(telegramUserId),
                balance: 0,
                tasksCompletedToday: 0,
                lastTaskTimestamp: null,
                totalEarned: 0,
                totalAdsViewed: 0,
                totalRefers: 0,
                joinedBonusTasks: [],
                referredBy: referrerId,
                referralEarnings: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            // Set local state immediately
            userState = newUserState;

            if (referrerId) {
                console.log(`Processing referral for referrer: ${referrerId}`);
                const referrerRef = db.collection('users').doc(referrerId);
                
                try {
                    await db.runTransaction(async (transaction) => {
                        const referrerDoc = await transaction.get(referrerRef);
                        
                        if (referrerDoc.exists) {
                            // Update referrer's stats
                            transaction.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1),
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            });
                            console.log(`Referrer ${referrerId} stats updated`);
                        } else {
                            console.warn(`Referrer ${referrerId} not found - removing referral`);
                            newUserState.referredBy = null;
                        }
                        
                        // Create new user
                        transaction.set(userRef, newUserState);
                    });
                    console.log("Referral transaction completed successfully");
                } catch (error) {
                    console.error("Referral transaction failed:", error);
                    // Fallback - create user without referral
                    newUserState.referredBy = null;
                    await userRef.set(newUserState);
                }
            } else {
                console.log("No referrer - creating standard user");
                await userRef.set(newUserState);
            }
        } else {
            console.log('Existing user data loaded');
            userState = doc.data();
        }
        
        if (!isInitialized) {
            setupTaskButtonListeners();
            listenForWithdrawalHistory();
            isInitialized = true;
        }
        updateUI();
    }, (error) => {
        console.error("Error listening to user document:", error);
        alert("Error loading user data. Please refresh the page.");
    });
}

// Helper functions
function generatePlaceholderAvatar(userId) { 
    return `https://i.pravatar.cc/150?u=${userId}`; 
}

function updateUI() {
    if (!userState) {
        console.warn("User state not loaded yet");
        return;
    }

    try {
        // Update profile images
        document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => { 
            img.src = userState.profilePicUrl || 'https://i.pravatar.cc/150'; 
        });

        // Format numbers
        const balanceString = Math.floor(userState.balance || 0).toLocaleString();
        const totalEarnedString = Math.floor(userState.totalEarned || 0).toLocaleString();
        const referralEarningsString = (userState.referralEarnings || 0).toLocaleString();
        const totalRefersString = (userState.totalRefers || 0).toLocaleString();

        // Update balances
        document.getElementById('balance-home').textContent = balanceString;
        document.getElementById('withdraw-balance').textContent = balanceString;
        document.getElementById('profile-balance').textContent = balanceString;

        // Update user info
        document.getElementById('home-username').textContent = userState.username || "User";
        document.getElementById('profile-name').textContent = userState.username || "User";
        document.getElementById('telegram-username').textContent = userState.telegramUsername || "@username";

        // Update task stats
        const tasksCompleted = userState.tasksCompletedToday || 0;
        document.getElementById('ads-watched-today').textContent = tasksCompleted;
        document.getElementById('ads-left-today').textContent = DAILY_TASK_LIMIT - tasksCompleted;
        document.getElementById('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
        
        // Update progress bar
        const progressPercentage = (tasksCompleted / DAILY_TASK_LIMIT) * 100;
        document.getElementById('task-progress-bar').style.width = `${progressPercentage}%`;
        
        // Update task button state
        const taskButton = document.getElementById('start-task-button');
        if (taskButton) {
            taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
            taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT ? 
                '<i class="fas fa-check-circle"></i> All tasks done' : 
                '<i class="fas fa-play-circle"></i> Watch Ad';
        }

        // Update stats
        document.getElementById('earned-so-far').textContent = totalEarnedString;
        document.getElementById('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
        document.getElementById('total-refers').textContent = totalRefersString;
        document.getElementById('refer-earnings').textContent = referralEarningsString;
        document.getElementById('refer-count').textContent = totalRefersString;
        document.getElementById('referral-earnings').textContent = referralEarningsString + ' PEPE';

        // Update completed tasks
        const joinedTasks = userState.joinedBonusTasks || [];
        document.querySelectorAll('.task-card').forEach(card => {
            const taskId = card.dataset.taskId;
            if (joinedTasks.includes(taskId)) {
                card.classList.add('completed');
            } else {
                card.classList.remove('completed');
            }
        });
    } catch (error) {
        console.error("Error updating UI:", error);
    }
}

// Referral commission system
async function payReferralCommission(earnedAmount) {
    if (!userState.referredBy || earnedAmount <= 0) return;
    
    const commissionAmount = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
    if (commissionAmount <= 0) return;

    const referrerRef = db.collection('users').doc(userState.referredBy);
    
    try {
        await referrerRef.update({
            balance: firebase.firestore.FieldValue.increment(commissionAmount),
            referralEarnings: firebase.firestore.FieldValue.increment(commissionAmount),
            totalEarned: firebase.firestore.FieldValue.increment(commissionAmount),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Paid ${commissionAmount} PEPE referral commission to ${userState.referredBy}`);
    } catch (error) {
        console.error("Failed to pay referral commission:", error);
    }
}

// Task handling functions
function setupTaskButtonListeners() {
    console.log("Setting up task button listeners");
    
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward);

        if (joinBtn) {
            joinBtn.addEventListener('click', (e) => {
                e.preventDefault();
                handleJoinClick(taskId, url);
            });
        }

        if (verifyBtn) {
            verifyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                handleVerifyClick(taskId, reward);
            });
        }
    });

    // Setup other button listeners
    const startTaskBtn = document.getElementById('start-task-button');
    if (startTaskBtn) {
        startTaskBtn.addEventListener('click', (e) => {
            e.preventDefault();
            completeAdTask();
        });
    }

    const withdrawBtn = document.querySelector('.submit-withdrawal-btn');
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', (e) => {
            e.preventDefault();
            submitWithdrawal();
        });
    }
}

async function handleVerifyClick(taskId, reward) {
    if (!userState) {
        alert("User data not loaded yet. Please wait...");
        return;
    }

    if (userState.joinedBonusTasks && userState.joinedBonusTasks.includes(taskId)) {
        alert("You have already completed this task.");
        return;
    }

    const taskCard = document.getElementById(`task-${taskId}`);
    if (!taskCard) {
        alert("Task not found. Please refresh the page.");
        return;
    }

    const verifyButton = taskCard.querySelector('.verify-btn');
    if (!verifyButton) return;

    verifyButton.disabled = true;
    verifyButton.textContent = "Verifying...";

    try {
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(reward),
            totalEarned: firebase.firestore.FieldValue.increment(reward),
            joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Pay referral commission if applicable
        await payReferralCommission(reward);

        alert(`Verification successful! You've earned ${reward} PEPE.`);
    } catch (error) {
        console.error("Error rewarding user for channel join:", error);
        alert("An error occurred. Please try again.");
        verifyButton.disabled = false;
        verifyButton.textContent = "Verify";
    }
}

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

// Ad task completion
async function completeAdTask() {
    if (!userState) {
        alert("User data not loaded yet. Please wait...");
        return;
    }

    if ((userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
        alert("You have completed all ad tasks for today!");
        return;
    }

    const taskButton = document.getElementById('start-task-button');
    if (!taskButton) return;
    
    try {
        taskButton.disabled = true;
        taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
        
        // Show ad (replace with your actual ad SDK call)
        if (typeof window.show_9685198 === 'function') {
            await window.show_9685198();
        } else {
            console.log("Ad SDK not available - simulating ad view");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(AD_REWARD),
            totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
            tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
            totalAdsViewed: firebase.firestore.FieldValue.increment(1),
            lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Pay referral commission if applicable
        await payReferralCommission(AD_REWARD);

        alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
    } catch (error) {
        console.error("An error occurred during the ad task:", error);
        alert("Ad could not be shown or was closed early. Please try again.");
    } finally {
        updateUI();
    }
}

// Withdrawal handling
async function submitWithdrawal() {
    if (!userState) {
        alert("User data not loaded yet. Please wait...");
        return;
    }

    const amountInput = document.getElementById('withdraw-amount');
    const amount = parseInt(amountInput.value);
    const method = document.getElementById('withdraw-method').value;
    const walletId = document.getElementById('wallet-id').value.trim();
    const minAmount = WITHDRAWAL_MINIMUMS[method];

    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount.');
        amountInput.focus();
        return;
    }

    if (!walletId) {
        alert('Please enter your Binance ID or Email.');
        document.getElementById('wallet-id').focus();
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
        const historyList = document.getElementById('history-list');
        const noHistoryMsg = historyList.querySelector('.no-history');
        
        if (noHistoryMsg) {
            noHistoryMsg.remove();
        }

        // Add optimistic UI update
        const optimisticData = {
            amount: amount,
            status: 'pending',
            requestedAt: new Date()
        };
        
        const optimisticItem = renderHistoryItem(optimisticData);
        historyList.prepend(optimisticItem);

        // Create withdrawal record
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

        // Update user balance
        const userRef = db.collection('users').doc(telegramUserId);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(-amount),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(`Success! Your withdrawal request for ${amount.toLocaleString()} PEPE has been submitted.`);
        
        // Clear form
        amountInput.value = '';
        document.getElementById('wallet-id').value = '';
    } catch (error) {
        console.error("Withdrawal failed:", error);
        alert("There was an error submitting your request. Please try again.");
    }
}

// History functions
function renderHistoryItem(withdrawalData) {
    const item = document.createElement('div');
    item.className = `history-item ${withdrawalData.status}`;
    
    const date = withdrawalData.requestedAt?.toDate ? 
        withdrawalData.requestedAt.toDate() : 
        new Date(withdrawalData.requestedAt || Date.now());
    
    const formattedDate = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
    });

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

function listenForWithdrawalHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    
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
        }, error => {
            console.error("Error loading withdrawal history:", error);
            historyList.innerHTML = '<p class="no-history">Error loading history. Please refresh.</p>';
        });
}

// UI Utility functions
function showTab(tabName, element) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element?.classList.add('active');
}

function openReferModal() {
    if (!TELEGRAM_BOT_USERNAME) {
        alert("Error: Bot username not set.");
        return;
    }
    
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    document.getElementById('referral-link').value = referralLink;
    document.getElementById('refer-modal').style.display = 'flex';
}

function closeReferModal() {
    document.getElementById('refer-modal').style.display = 'none';
}

function copyReferralLink(button) {
    const linkInput = document.getElementById('referral-link');
    
    navigator.clipboard.writeText(linkInput.value).then(() => {
        const originalIcon = button.innerHTML;
        button.innerHTML = '<i class="fas fa-check"></i>';
        
        setTimeout(() => {
            button.innerHTML = originalIcon;
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert("Failed to copy link. Please try again.");
    });
}

// Event delegation for dynamically added elements
document.addEventListener('click', function(event) {
    // Handle modal close when clicking outside
    if (event.target == document.getElementById('refer-modal')) {
        closeReferModal();
    }
    
    // Handle tab switching
    if (event.target.closest('.nav-item')) {
        const navItem = event.target.closest('.nav-item');
        const tabName = navItem.querySelector('i').className.replace('fas fa-', '');
        showTab(tabName === 'home' ? 'home' : 
                tabName === 'coins' ? 'earn' : 
                tabName === 'wallet' ? 'withdraw' : 
                tabName === 'user' ? 'profile' : 'home', 
                navItem);
    }
});

// --- [APP ENTRY POINT] ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Telegram Web App
    if (window.Telegram && window.Telegram.WebApp) {
        try {
            Telegram.WebApp.ready();
            Telegram.WebApp.expand();
            
            // Initialize with Telegram user data
            const tgUser = window.Telegram.WebApp.initDataUnsafe?.user;
            if (tgUser) {
                console.log("Telegram user data:", tgUser);
                initializeApp(tgUser);
            } else {
                console.warn("No Telegram user data found");
                initializeApp(null);
            }
        } catch (error) {
            console.error("Error initializing Telegram WebApp:", error);
            initializeApp(null);
        }
    } else {
        console.warn("Telegram WebApp not detected - running in test mode");
        initializeApp(null);
    }
});

// Expose functions to global scope
window.showTab = showTab;
window.openReferModal = openReferModal;
window.closeReferModal = closeReferModal;
window.copyReferralLink = copyReferralLink;
window.completeAdTask = completeAdTask;
window.submitWithdrawal = submitWithdrawal;
