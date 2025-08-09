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

    const userRef = db.collection('users').doc(telegramUserId);

    userRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
            console.log('New user detected. Creating account...');

            const referrerId = tgUser?.start_param || new URLSearchParams(window.location.search).get('ref');

            // ✅ Prevent self-referrals
            const validReferrer = referrerId && referrerId !== telegramUserId;

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
                referredBy: validReferrer || null,
                referralEarnings: 0
            };

            try {
                await db.runTransaction(async (transaction) => {
                    // Create new user
                    transaction.set(userRef, newUserState);

                    // If valid referrer, increment their referral count
                    if (validReferrer) {
                        const referrerRef = db.collection('users').doc(validReferrer);
                        const referrerDoc = await transaction.get(referrerRef);
                        if (referrerDoc.exists) {
                            transaction.update(referrerRef, {
                                totalRefers: firebase.firestore.FieldValue.increment(1)
                            });
                        }
                    }
                });
                console.log("User created successfully with referral logic applied.");
            } catch (error) {
                console.error("Referral transaction failed, creating user without referral increment.", error);
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

// --- Rest of your code stays the same ---
