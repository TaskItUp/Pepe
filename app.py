import os
from flask import Flask, request, jsonify
import firebase_admin
from firebase_admin import credentials, firestore
import datetime

# --- [FLASK & FIREBASE INITIALIZATION] ---

app = Flask(__name__)

# Initialize Firebase Admin SDK
# Make sure 'serviceAccountKey.json' is in the same directory
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# --- [CONSTANTS] ---

DAILY_TASK_LIMIT = 40
AD_REWARD = 250
REFERRAL_COMMISSION_RATE = 0.10
WITHDRAWAL_MINIMUMS = {
    "binancepay": 10000
}

# --- [HELPER FUNCTIONS] ---

def pay_referral_commission(referrer_id, earned_amount):
    if not referrer_id:
        return

    commission_amount = int(earned_amount * REFERRAL_COMMISSION_RATE)
    if commission_amount <= 0:
        return

    try:
        referrer_ref = db.collection('users').document(referrer_id)
        referrer_ref.update({
            'balance': firestore.Increment(commission_amount),
            'referralEarnings': firestore.Increment(commission_amount)
        })
        print(f"Successfully paid {commission_amount} commission to {referrer_id}")
    except Exception as e:
        print(f"Error paying commission to {referrer_id}: {e}")


# --- [API ENDPOINTS] ---

@app.route('/initialize_user', methods=['POST'])
def initialize_user():
    data = request.json
    user_id = str(data.get('userId'))
    user_info = data.get('userInfo', {})
    referrer_id = data.get('referrerId')

    if not user_id:
        return jsonify({"error": "User ID is required"}), 400

    user_ref = db.collection('users').document(user_id)
    doc = user_ref.get()

    if not doc.exists:
        print(f"New user detected: {user_id}. Referrer: {referrer_id}")
        
        new_user_state = {
            'username': user_info.get('username', 'User'),
            'telegramUsername': user_info.get('telegramUsername', f'@{user_id}'),
            'profilePicUrl': f"https://i.pravatar.cc/150?u={user_id}",
            'balance': 0,
            'tasksCompletedToday': 0,
            'lastTaskTimestamp': None,
            'totalEarned': 0,
            'totalAdsViewed': 0,
            'totalRefers': 0,
            'joinedBonusTasks': [],
            'referredBy': referrer_id or None,
            'referralEarnings': 0
        }

        # Transaction to ensure referral is counted correctly
        if referrer_id:
            try:
                @firestore.transactional
                def update_in_transaction(transaction, new_user_ref, referrer_doc_ref):
                    referrer_doc = referrer_doc_ref.get(transaction=transaction)
                    if referrer_doc.exists:
                        transaction.update(referrer_doc_ref, {
                            'totalRefers': firestore.Increment(1)
                        })
                    transaction.set(new_user_ref, new_user_state)
                
                referrer_ref = db.collection('users').document(referrer_id)
                update_in_transaction(db.transaction(), user_ref, referrer_ref)
                print(f"Referral successfully processed for user {user_id} by {referrer_id}")

            except Exception as e:
                print(f"FATAL: Referral transaction failed: {e}. Creating user without referral.")
                new_user_state['referredBy'] = None
                user_ref.set(new_user_state)
        else:
            user_ref.set(new_user_state)

        return jsonify(new_user_state), 201 # 201 Created
    else:
        return jsonify(doc.to_dict()), 200 # 200 OK

@app.route('/complete_ad_task', methods=['POST'])
def complete_ad_task():
    data = request.json
    user_id = str(data.get('userId'))

    if not user_id:
        return jsonify({"error": "User ID is required"}), 400

    user_ref = db.collection('users').document(user_id)
    doc = user_ref.get()

    if not doc.exists:
        return jsonify({"error": "User not found"}), 404

    user_data = doc.to_dict()
    
    # You might want to add logic here to reset tasks daily
    if user_data.get('tasksCompletedToday', 0) >= DAILY_TASK_LIMIT:
        return jsonify({"error": "All tasks for today already completed"}), 403

    # Update user stats
    user_ref.update({
        'balance': firestore.Increment(AD_REWARD),
        'totalEarned': firestore.Increment(AD_REWARD),
        'tasksCompletedToday': firestore.Increment(1),
        'totalAdsViewed': firestore.Increment(1),
        'lastTaskTimestamp': firestore.SERVER_TIMESTAMP
    })

    # Pay commission to referrer
    if user_data.get('referredBy'):
        pay_referral_commission(user_data['referredBy'], AD_REWARD)

    return jsonify({"success": True, "reward": AD_REWARD}), 200

@app.route('/verify_bonus_task', methods=['POST'])
def verify_bonus_task():
    data = request.json
    user_id = str(data.get('userId'))
    task_id = data.get('taskId')
    reward = int(data.get('reward', 0))

    if not all([user_id, task_id, reward]):
         return jsonify({"error": "Missing required fields"}), 400

    user_ref = db.collection('users').document(user_id)
    doc = user_ref.get()
    if not doc.exists:
        return jsonify({"error": "User not found"}), 404
    
    user_data = doc.to_dict()
    if task_id in user_data.get('joinedBonusTasks', []):
        return jsonify({"error": "Task already completed"}), 409

    user_ref.update({
        'balance': firestore.Increment(reward),
        'totalEarned': firestore.Increment(reward),
        'joinedBonusTasks': firestore.ArrayUnion([task_id])
    })

    if user_data.get('referredBy'):
        pay_referral_commission(user_data['referredBy'], reward)

    return jsonify({"success": True, "reward": reward}), 200


@app.route('/submit_withdrawal', methods=['POST'])
def submit_withdrawal():
    data = request.json
    user_id = str(data.get('userId'))
    amount = int(data.get('amount', 0))
    wallet_id = data.get('walletId')

    if not all([user_id, amount, wallet_id]):
        return jsonify({"error": "Missing required fields"}), 400

    user_ref = db.collection('users').document(user_id)
    doc = user_ref.get()
    if not doc.exists:
        return jsonify({"error": "User not found"}), 404

    user_data = doc.to_dict()
    if user_data.get('balance', 0) < amount:
        return jsonify({"error": "Insufficient balance"}), 403
    
    if amount < WITHDRAWAL_MINIMUMS['binancepay']:
        return jsonify({"error": f"Minimum withdrawal is {WITHDRAWAL_MINIMUMS['binancepay']}"}), 403

    # Process withdrawal
    try:
        # Subtract balance first
        user_ref.update({'balance': firestore.Increment(-amount)})

        # Add to withdrawals collection
        db.collection('withdrawals').add({
            'userId': user_id,
            'username': user_data.get('telegramUsername'),
            'amount': amount,
            'method': "Binance Pay",
            'walletId': wallet_id,
            'currency': "PEPE",
            'status': "pending",
            'requestedAt': firestore.SERVER_TIMESTAMP
        })
        return jsonify({"success": True}), 200
    except Exception as e:
        # Rollback balance if withdrawal fails
        user_ref.update({'balance': firestore.Increment(amount)})
        return jsonify({"error": "Withdrawal failed, please try again"}), 500


@app.route('/get_withdrawal_history', methods=['GET'])
def get_withdrawal_history():
    user_id = request.args.get('userId')
    if not user_id:
        return jsonify({"error": "User ID is required"}), 400

    docs = db.collection('withdrawals').where('userId', '==', user_id).order_by('requestedAt', direction=firestore.Query.DESCENDING).limit(10).stream()
    
    history = []
    for doc in docs:
        item = doc.to_dict()
        # Convert timestamp to a readable format
        if 'requestedAt' in item and isinstance(item['requestedAt'], datetime.datetime):
            item['requestedAt'] = item['requestedAt'].isoformat()
        history.append(item)
        
    return jsonify(history), 200

# --- [RUN THE APP] ---

if __name__ == '__main__':
    # For development, you can run it like this.
    # For production, use a proper WSGI server like Gunicorn or Waitress.
    app.run(host='0.0.0.0', port=5000, debug=True)