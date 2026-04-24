const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = getFirestore();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, fcmToken, childName } = req.body;

  if (!userId || !fcmToken) {
    return res.status(400).json({ error: 'userId and fcmToken required' });
  }

  try {
    await db.collection('users').doc(userId).set({
      fcmToken,
      childName: childName || 'My Child',
      notificationsEnabled: true,
      updatedAt: Date.now()
    }, { merge: true });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save token', details: error.message });
  }
};
