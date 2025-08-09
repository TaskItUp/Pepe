// -----------------------------
// script.js (robust & fallback)
// -----------------------------

// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyB1TYSc2keBepN_cMV9oaoHFRdcJaAqG_g",
    authDomain: "taskup-9ba7b.firebaseapp.com",
    projectId: "taskup-9ba7b",
    storageBucket: "taskup-9ba7b.appspot.com",
    messagingSenderId: "319481101196",
    appId: "1:319481101196:web:6cded5be97620d98d974a9",
    measurementId: "G-JNNLG1E49L"
};

const TELEGRAM_BOT_USERNAME = "TaskItUpBot";
const DAILY_TASK_LIMIT = 40;
const AD_REWARD = 250;
const REFERRAL_COMMISSION_RATE = 0.10;
const WITHDRAWAL_MINIMUMS = { binancepay: 10000 };

// --- STATE ---
let useFirebase = false;
let db = null; // firebase firestore instance or null (when fallback)
let userState = {};
let telegramUserId = null;
let isInitialized = false;

// --- Init DB (firebase if available) ---
function initDatabase() {
    try {
        // If firebase is available on window, initialize and use firestore
        if (window.firebase && window.firebase.initializeApp) {
            // If firebase app isn't already initialized, initialize it.
            try {
                // Some environments may have initialized firebase already; safe-guard
                if (!firebase.apps || firebase.apps.length === 0) {
                    firebase.initializeApp(firebaseConfig);
                }
                db = firebase.firestore();
                useFirebase = true;
                console.log("Using Firebase Firestore as DB.");
            } catch (e) {
                console.warn("Firebase initializeApp failed, falling back to local DB:", e);
                useFirebase = false;
            }
        } else {
            console.warn("Firebase SDK not found - falling back to local storage DB.");
            useFirebase = false;
        }
    } catch (err) {
        console.error("DB initialization failure — falling back to local:", err);
        useFirebase = false;
    }
}

// --- Local fallback DB helpers (minimal) ---
const LS_PREFIX = 'taskapp_v1_';
function lsGet(key, fallback = null) {
    try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        console.error("localStorage read error:", e);
        return fallback;
    }
}
function lsSet(key, value) {
    try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch (e) {
        console.error("localStorage write error:", e);
    }
}
function ensureLocalStores() {
    if (lsGet('users', null) === null) lsSet('users', {}); // object keyed by userId
    if (lsGet('withdrawals', null) === null) lsSet('withdrawals', []); // array
}

// Wrapper DB API used by the rest of the app
const DB = {
    async runTransaction(fn) {
        if (useFirebase) {
            return db.runTransaction(fn);
        } else {
            // Simple local transaction: pass an object with get/set convenience
            ensureLocalStores();
            const users = lsGet('users');
            const tx = {
                get: async (ref) => {
                    const id = ref._id;
                    return { exists: !!users[id], data: () => users[id] || null };
                },
                set: async (ref, data) => {
                    const id = ref._id;
                    users[id] = data;
                },
                update: async (ref, updates) => {
                    const id = ref._id;
                    const doc = users[id] || {};
                    // Apply simple ops: increment and arrayUnion used by our code
                    Object.keys(updates).forEach(k => {
                        const v = updates[k];
                        // detect firebase.FieldValue style strings if used - we don't rely on that
                        if (v && typeof v === 'object' && v.__op === 'INCREMENT') {
                            doc[k] = (doc[k] || 0) + v.amount;
                        } else if (v && typeof v === 'object' && v.__op === 'ARRAY_UNION') {
                            doc[k] = doc[k] || [];
                            if (!doc[k].includes(v.value)) doc[k].push(v.value);
                        } else {
                            doc[k] = v;
                        }
                    });
                    users[id] = doc;
                }
            };
            await fn(tx);
            lsSet('users', users);
        }
    },

    collectionRef(collectionName, id = null) {
        // return a small local reference object used by other methods
        return { _collection: collectionName, _id: id };
    },

    async getUserDoc(userId) {
        if (useFirebase) {
            const doc = await db.collection('users').doc(userId).get();
            return { exists: doc.exists, data: doc.data ? doc.data() : null };
        } else {
            ensureLocalStores();
            const users = lsGet('users', {});
            return { exists: !!users[userId], data: users[userId] || null };
        }
    },

    async setUserDoc(userId, data) {
        if (useFirebase) {
            return db.collection('users').doc(userId).set(data);
        } else {
            ensureLocalStores();
            const users = lsGet('users', {});
            users[userId] = data;
            lsSet('users', users);
            return Promise.resolve();
        }
    },

    async updateUserDoc(userId, updates) {
        if (useFirebase) {
            // allow updates to be passed directly, e.g. FieldValue.increment
            return db.collection('users').doc(userId).update(updates);
        } else {
            ensureLocalStores();
            const users = lsGet('users', {});
            const doc = users[userId] || {};
            // Handle a few common update patterns we use: { field: value }, increment, arrayUnion markers
            Object.keys(updates).forEach(k => {
                const v = updates[k];
                if (v && typeof v === 'object' && v.__op === 'INCREMENT') {
                    doc[k] = (doc[k] || 0) + v.amount;
                } else if (v && typeof v === 'object' && v.__op === 'ARRAY_UNION') {
                    doc[k] = doc[k] || [];
                    if (!doc[k].includes(v.value)) doc[k].push(v.value);
                } else {
                    doc[k] = v;
                }
            });
            users[userId] = doc;
            lsSet('users', users);
            return Promise.resolve();
        }
    },

    async addWithdrawal(record) {
        if (useFirebase) {
            return db.collection('withdrawals').add(record);
        } else {
            ensureLocalStores();
            const list = lsGet('withdrawals', []);
            list.unshift(Object.assign({}, record, { _localId: Date.now() }));
            lsSet('withdrawals', list);
            return Promise.resolve();
        }
    },

    listenUserDoc(userId, onChange, onError) {
        if (useFirebase) {
            return db.collection('users').doc(userId).onSnapshot(doc => {
                onChange({ exists: doc.exists, data: doc.data ? doc.data() : null });
            }, onError);
        } else {
            // Local mode: call once with current value and return a noop unsubscribe
            (async () => {
                const doc = await this.getUserDoc(userId);
                onChange(doc);
            })();
            return () => { /* noop */ };
        }
    },

    listenWithdrawals(userId, onChange, onError) {
        if (useFirebase) {
            return db.collection('withdrawals')
                .where('userId', '==', userId)
                .orderBy('requestedAt', 'desc')
                .limit(10)
                .onSnapshot(qs => {
                    if (!qs.empty) {
                        const items = [];
                        qs.forEach(d => items.push(d.data()));
                        onChange(items);
                    } else {
                        onChange([]);
                    }
                }, onError);
        } else {
            (async () => {
                const list = lsGet('withdrawals', []);
                const filtered = list.filter(i => i.userId === userId).slice(0, 10);
                onChange(filtered);
            })();
            return () => { /* noop */ };
        }
    },

    // Convenience helpers for local increment and arrayUnion markers
    LocalIncrement(amount) { return { __op: 'INCREMENT', amount }; },
    LocalArrayUnion(value) { return { __op: 'ARRAY_UNION', value }; }
};

// --- Utilities ---
function generatePlaceholderAvatar(userId) {
    return `https://i.pravatar.cc/150?u=${userId}`;
}
function getFakeUserIdForTesting() {
    let storedId = localStorage.getItem('localAppUserId');
    if (storedId) return storedId;
    const newId = 'test_user_' + Date.now().toString(36);
    localStorage.setItem('localAppUserId', newId);
    return newId;
}
function getReferrerIdFromContext(tgUser) {
    // 1. Telegram WebApp start_param
    let refId = window.Telegram?.WebApp?.initDataUnsafe?.start_param || null;
    // 2. URL param ?ref=...
    const params = new URLSearchParams(window.location.search);
    if (!refId && params.has("ref")) refId = params.get("ref");
    // Protect self-referral
    if (refId && tgUser && refId.toString() === tgUser.id.toString()) return null;
    return refId;
}

// --- UI helpers ---
function safeQuery(selector) { return document.querySelector(selector); }
function $(id) { return document.getElementById(id); }

// Render history item (works for firebase Document or local stub)
function renderHistoryItem(withdrawalData) {
    const item = document.createElement('div');
    item.className = `history-item ${withdrawalData.status || 'pending'}`;
    const date = withdrawalData.requestedAt && (withdrawalData.requestedAt.toDate ? withdrawalData.requestedAt.toDate() : new Date(withdrawalData.requestedAt)) || new Date();
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    item.innerHTML = `
        <div class="history-details">
            <div class="history-amount">${(withdrawalData.amount || 0).toLocaleString()} PEPE</div>
            <div class="history-date">${formattedDate}</div>
        </div>
        <div class="history-status ${withdrawalData.status || 'pending'}">${withdrawalData.status || 'pending'}</div>
    `;
    return item;
}

// --- Setup task button listeners (called at DOM ready) ---
function setupTaskButtonListeners() {
    // Attach to static buttons
    document.querySelectorAll('.task-card').forEach(card => {
        const joinBtn = card.querySelector('.join-btn');
        const verifyBtn = card.querySelector('.verify-btn');
        const taskId = card.dataset.taskId;
        const url = card.dataset.url;
        const reward = parseInt(card.dataset.reward) || 0;

        if (joinBtn) joinBtn.addEventListener('click', () => handleJoinClick(taskId, url));
        if (verifyBtn) verifyBtn.addEventListener('click', () => handleVerifyClick(taskId, reward));
    });

    // Make sure global button handlers exist for direct onclick attrs
    window.completeAdTask = completeAdTask;
    window.submitWithdrawal = submitWithdrawal;
    window.openReferModal = openReferModal;
    window.closeReferModal = closeReferModal;
    window.copyReferralLink = copyReferralLink;
    window.showTab = showTab;
}

// --- Task / Join / Verify handlers ---
function handleJoinClick(taskId, url) {
    const taskCard = document.getElementById(`task-${taskId}`);
    if (!taskCard) return;
    const joinButton = taskCard.querySelector('.join-btn');
    const verifyButton = taskCard.querySelector('.verify-btn');

    // Open link
    if (url) window.open(url, '_blank');

    // Enable verify and disable join visually
    if (verifyButton) verifyButton.disabled = false;
    if (joinButton) joinButton.disabled = true;

    alert("After joining, return to the app and press 'Verify' to claim your reward.");
}

async function handleVerifyClick(taskId, reward) {
    try {
        if (!userState.joinedBonusTasks) userState.joinedBonusTasks = [];
        if (userState.joinedBonusTasks.includes(taskId)) {
            alert("You have already completed this task.");
            return;
        }

        const taskCard = document.getElementById(`task-${taskId}`);
        const verifyButton = taskCard ? taskCard.querySelector('.verify-btn') : null;
        if (verifyButton) {
            verifyButton.disabled = true;
            verifyButton.textContent = "Verifying...";
        }

        const userRefId = telegramUserId;
        if (!userRefId) throw new Error("Missing user id.");

        if (useFirebase) {
            // Use Firestore utilities
            await DB.updateUserDoc(userRefId, {
                balance: firebase.firestore.FieldValue.increment(reward),
                totalEarned: firebase.firestore.FieldValue.increment(reward),
                joinedBonusTasks: firebase.firestore.FieldValue.arrayUnion(taskId)
            });
        } else {
            await DB.updateUserDoc(userRefId, {
                balance: DB.LocalIncrement(reward),
                totalEarned: DB.LocalIncrement(reward),
                joinedBonusTasks: DB.LocalArrayUnion(taskId)
            });
        }

        // pay referral commission if applicable
        await payReferralCommission(reward);

        alert(`Verification successful! You've earned ${reward} PEPE.`);
    } catch (err) {
        console.error("Error in verify click:", err);
        alert("An error occurred. Please try again.");
    } finally {
        // refresh UI data by re-fetching user doc
        refreshUserDocAndUI();
    }
}

// --- AD TASK ---
async function completeAdTask() {
    try {
        if (!userState || (userState.tasksCompletedToday || 0) >= DAILY_TASK_LIMIT) {
            alert("You have completed all ad tasks for today!");
            return;
        }

        const taskButton = $('start-task-button');
        if (taskButton) {
            taskButton.disabled = true;
            taskButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';
        }

        // Try show ad via ad SDK if available
        if (typeof window.show_9685198 === 'function') {
            try { await window.show_9685198(); } catch(e) { console.warn("Ad SDK show failed:", e); }
        } else {
            // Simple simulation for testing
            await new Promise(res => setTimeout(res, 800));
        }

        const userRefId = telegramUserId;
        if (!userRefId) throw new Error("Missing user id.");

        if (useFirebase) {
            await DB.updateUserDoc(userRefId, {
                balance: firebase.firestore.FieldValue.increment(AD_REWARD),
                totalEarned: firebase.firestore.FieldValue.increment(AD_REWARD),
                tasksCompletedToday: firebase.firestore.FieldValue.increment(1),
                totalAdsViewed: firebase.firestore.FieldValue.increment(1),
                lastTaskTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            await DB.updateUserDoc(userRefId, {
                balance: DB.LocalIncrement(AD_REWARD),
                totalEarned: DB.LocalIncrement(AD_REWARD),
                tasksCompletedToday: DB.LocalIncrement(1),
                totalAdsViewed: DB.LocalIncrement(1),
                lastTaskTimestamp: new Date().toISOString()
            });
        }

        await payReferralCommission(AD_REWARD);

        alert(`Success! ${AD_REWARD} PEPE has been added to your balance.`);
    } catch (error) {
        console.error("completeAdTask error:", error);
        alert("Ad could not be shown or was closed early. Please try again.");
    } finally {
        refreshUserDocAndUI();
    }
}

// --- Referral commission payer ---
async function payReferralCommission(earnedAmount) {
    try {
        if (!userState || !userState.referredBy) return;
        const commission = Math.floor(earnedAmount * REFERRAL_COMMISSION_RATE);
        if (commission <= 0) return;

        const refId = userState.referredBy;
        if (useFirebase) {
            const refRef = db.collection('users').doc(refId);
            await refRef.update({
                balance: firebase.firestore.FieldValue.increment(commission),
                referralEarnings: firebase.firestore.FieldValue.increment(commission)
            });
        } else {
            // local update
            await DB.updateUserDoc(refId, {
                balance: DB.LocalIncrement(commission),
                referralEarnings: DB.LocalIncrement(commission)
            });
        }
    } catch (e) {
        console.error("Failed to pay referral:", e);
    }
}

// --- Withdrawals ---
async function submitWithdrawal() {
    try {
        const amountVal = parseInt(($('withdraw-amount') && $('withdraw-amount').value) || 0);
        const method = ($('withdraw-method') && $('withdraw-method').value) || 'binancepay';
        const walletId = ($('wallet-id') && $('wallet-id').value || '').trim();
        const min = WITHDRAWAL_MINIMUMS[method] || 0;

        if (!amountVal || amountVal <= 0 || !walletId) {
            alert('Please enter a valid amount and your Binance ID or Email.');
            return;
        }
        if (amountVal < min) {
            alert(`Withdrawal failed. Minimum is ${min.toLocaleString()} PEPE.`);
            return;
        }
        if (amountVal > (userState.balance || 0)) {
            alert('Withdrawal failed. Not enough balance.');
            return;
        }

        const optimistic = { userId: telegramUserId, amount: amountVal, status: 'pending', requestedAt: new Date() };
        const historyList = $('history-list');
        if (historyList) {
            const noHistoryMsg = historyList.querySelector('.no-history');
            if (noHistoryMsg) noHistoryMsg.remove();
            historyList.prepend(renderHistoryItem(optimistic));
        }

        if (useFirebase) {
            await DB.addWithdrawal({
                userId: telegramUserId,
                username: userState.telegramUsername || '@unknown',
                amount: amountVal,
                method: "Binance Pay",
                walletId: walletId,
                currency: "PEPE",
                status: "pending",
                requestedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await DB.updateUserDoc(telegramUserId, { balance: firebase.firestore.FieldValue.increment(-amountVal) });
        } else {
            await DB.addWithdrawal({
                userId: telegramUserId,
                username: userState.telegramUsername || '@unknown',
                amount: amountVal,
                method: "Binance Pay",
                walletId: walletId,
                currency: "PEPE",
                status: "pending",
                requestedAt: new Date().toISOString()
            });
            await DB.updateUserDoc(telegramUserId, { balance: DB.LocalIncrement(-amountVal) });
        }

        alert(`Success! Withdrawal request for ${amountVal.toLocaleString()} PEPE submitted.`);
        if ($('withdraw-amount')) $('withdraw-amount').value = '';
        if ($('wallet-id')) $('wallet-id').value = '';
    } catch (err) {
        console.error("submitWithdrawal error:", err);
        alert("There was an error submitting your request. Please try again.");
    } finally {
        refreshUserDocAndUI();
    }
}

function listenForWithdrawalHistory() {
    DB.listenWithdrawals(telegramUserId, (items) => {
        const historyList = $('history-list');
        if (!historyList) return;
        if (!items || items.length === 0) {
            historyList.innerHTML = '<p class="no-history">You have no withdrawal history yet.</p>';
            return;
        }
        historyList.innerHTML = '';
        items.forEach(i => historyList.appendChild(renderHistoryItem(i)));
    }, (e) => console.error("withdrawals listener error:", e));
}

// --- Referral modal & copy ---
function openReferModal() {
    if (!TELEGRAM_BOT_USERNAME) { alert("Error: Bot username not set."); return; }
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    const input = $('referral-link');
    if (input) input.value = referralLink;
    const modal = $('refer-modal');
    if (modal) modal.style.display = 'flex';
}
function closeReferModal() {
    const modal = $('refer-modal'); if (modal) modal.style.display = 'none';
}
function copyReferralLink(buttonOrEvent, inputId = 'referral-link') {
    // buttonOrEvent may be a button element or the event object
    let button = null;
    if (buttonOrEvent && buttonOrEvent.currentTarget) button = buttonOrEvent.currentTarget;
    else if (buttonOrEvent instanceof HTMLElement) button = buttonOrEvent;

    const linkInput = $(inputId);
    if (!linkInput) {
        alert("Referral link input not found.");
        return;
    }
    navigator.clipboard?.writeText(linkInput.value).then(() => {
        if (button) {
            const original = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => button.innerHTML = original, 1500);
        } else {
            alert("Referral link copied!");
        }
    }).catch(err => {
        console.warn("Clipboard failed:", err);
        prompt("Copy this link:", linkInput.value);
    });
}

// close modal on overlay click
window.onclick = function (event) {
    const modal = $('refer-modal');
    if (modal && event.target === modal) closeReferModal();
};

// --- Tabs ---
function showTab(tabName, element) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const el = document.getElementById(tabName);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (element) element.classList.add('active');
}

// --- UI Updater (rebuilds DOM values from userState) ---
function updateUI() {
    if (!userState) return;
    const balance = Math.floor(userState.balance || 0).toLocaleString();
    const totalEarned = Math.floor(userState.totalEarned || 0).toLocaleString();
    const referralEarnings = (userState.referralEarnings || 0).toLocaleString();
    const totalRefers = (userState.totalRefers || 0).toLocaleString();

    document.querySelectorAll('.profile-pic, .profile-pic-large').forEach(img => {
        if (userState.profilePicUrl) img.src = userState.profilePicUrl;
    });

    if ($('balance-home')) $('balance-home').textContent = balance;
    if ($('withdraw-balance')) $('withdraw-balance').textContent = balance;
    if ($('profile-balance')) $('profile-balance').textContent = balance;
    if ($('home-username')) $('home-username').textContent = userState.username || 'User';
    if ($('profile-name')) $('profile-name').textContent = userState.username || 'User';
    if ($('telegram-username')) $('telegram-username').textContent = userState.telegramUsername || '@unknown';
    if ($('ads-watched-today')) $('ads-watched-today').textContent = userState.tasksCompletedToday || 0;
    if ($('ads-left-today')) $('ads-left-today').textContent = DAILY_TASK_LIMIT - (userState.tasksCompletedToday || 0);

    const tasksCompleted = userState.tasksCompletedToday || 0;
    if ($('tasks-completed')) $('tasks-completed').textContent = `${tasksCompleted} / ${DAILY_TASK_LIMIT}`;
    if ($('task-progress-bar')) $('task-progress-bar').style.width = `${(tasksCompleted / DAILY_TASK_LIMIT) * 100}%`;

    const taskButton = $('start-task-button');
    if (taskButton) {
        taskButton.disabled = tasksCompleted >= DAILY_TASK_LIMIT;
        taskButton.innerHTML = tasksCompleted >= DAILY_TASK_LIMIT ? '<i class="fas fa-check-circle"></i> All tasks done' : '<i class="fas fa-play-circle"></i> Watch Ad';
    }

    if ($('earned-so-far')) $('earned-so-far').textContent = totalEarned;
    if ($('total-ads-viewed')) $('total-ads-viewed').textContent = userState.totalAdsViewed || 0;
    if ($('total-refers')) $('total-refers').textContent = totalRefers;
    if ($('refer-earnings')) $('refer-earnings').textContent = referralEarnings;
    if ($('refer-count')) $('refer-count').textContent = totalRefers;

    // mark joined tasks
    const joined = userState.joinedBonusTasks || [];
    joined.forEach(tid => {
        const taskCard = document.getElementById(`task-${tid}`);
        if (taskCard) taskCard.classList.add('completed');
    });

    // referral link fields
    const referralLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramUserId}`;
    if ($('referral-link')) $('referral-link').value = referralLink;
    if ($('profile-referral-link')) $('profile-referral-link').value = referralLink;
}

// Re-fetch user doc and update UI (works both modes)
async function refreshUserDocAndUI() {
    try {
        const doc = await DB.getUserDoc(telegramUserId);
        if (doc && doc.exists) {
            userState = doc.data || doc.data();
        }
    } catch (e) { console.error("refresh user error:", e); }
    updateUI();
}

// --- App initialization & user doc listener ---
async function initializeApp(tgUser) {
    initDatabase();
    if (!useFirebase) ensureLocalStores();

    telegramUserId = tgUser ? tgUser.id.toString() : getFakeUserIdForTesting();
    console.log("Initializing app for user:", telegramUserId);

    // set up UI listeners immediately (so buttons respond even before DB resolves)
    if (!isInitialized) {
        setupTaskButtonListeners();
        isInitialized = true;
    }

    // Listen for user doc; if not exist create
    DB.listenUserDoc(telegramUserId, async (doc) => {
        try {
            if (!doc || !doc.exists) {
                console.log("Creating new user doc for", telegramUserId);

                const referrerId = getReferrerIdFromContext(tgUser);
                const newUser = {
                    username: tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || 'User' : 'User',
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

                if (referrerId && referrerId !== telegramUserId) {
                    // Use runTransaction both firebase and local
                    try {
                        await DB.runTransaction(async (transaction) => {
                            const refRef = DB.collectionRef('users', referrerId);
                            const refDoc = await transaction.get(refRef);
                            if (!refDoc.exists) {
                                // create minimal referrer doc
                                await transaction.set(refRef, {
                                    username: "Referrer",
                                    telegramUsername: "@unknown",
                                    profilePicUrl: generatePlaceholderAvatar(referrerId),
                                    balance: 0,
                                    tasksCompletedToday: 0,
                                    lastTaskTimestamp: null,
                                    totalEarned: 0,
                                    totalAdsViewed: 0,
                                    totalRefers: 1,
                                    joinedBonusTasks: [],
                                    referredBy: null,
                                    referralEarnings: 0
                                });
                            } else {
                                await transaction.update(refRef, {
                                    totalRefers: useFirebase ? firebase.firestore.FieldValue.increment(1) : DB.LocalIncrement(1)
                                });
                            }
                            // create new user doc
                            const userRef = DB.collectionRef('users', telegramUserId);
                            await transaction.set(userRef, newUser);
                        });
                    } catch (txErr) {
                        console.error("Referral transaction error:", txErr);
                        // fallback: create user without referral
                        newUser.referredBy = null;
                        await DB.setUserDoc(telegramUserId, newUser);
                    }
                } else {
                    await DB.setUserDoc(telegramUserId, newUser);
                }
            } else {
                // existing user doc
                userState = doc.data || doc.data();
            }
        } catch (err) {
            console.error("Error in user doc listener:", err);
        } finally {
            // After setting/reading the doc, refresh UI
            refreshUserDocAndUI();
            // start listening withdrawals
            listenForWithdrawalHistory();
        }
    }, (err) => {
        console.error("user doc listen error:", err);
    });
}

// --- DOMContentLoaded entrypoint ---
document.addEventListener('DOMContentLoaded', () => {
    // Setup DB early
    initDatabase();

    // Attach UI handlers early so buttons are responsive
    setupTaskButtonListeners();

    // Telegram WebApp presence
    if (window.Telegram && window.Telegram.WebApp) {
        try {
            Telegram.WebApp.ready();
        } catch (e) { console.warn("Telegram.WebApp.ready() failed:", e); }
        const tgUser = window.Telegram.WebApp.initDataUnsafe?.user || null;
        initializeApp(tgUser);
    } else {
        console.warn("Telegram WebApp not found. Running in local test mode.");
        initializeApp(null);
    }
});
