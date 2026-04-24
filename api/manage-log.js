const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId, logId, data } = req.body;
  if (!userId || !logId) return res.status(400).json({ error: 'userId and logId required' });

  try {
    const ref = db.collection('users').doc(userId).collection('logs').doc(logId);

    if (req.method === 'DELETE') {
      await ref.delete();
      return res.status(200).json({ success: true, action: 'deleted' });
    }

    if (req.method === 'POST') {
      if (!data) return res.status(400).json({ error: 'data required for update' });
      await ref.update({ data, updatedAt: Date.now() });
      return res.status(200).json({ success: true, action: 'updated' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    return res.status(500).json({ error: 'Operation failed', details: error.message });
  }
};
