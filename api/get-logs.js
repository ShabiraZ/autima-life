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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, limit = 50, type } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    let query = db
      .collection('users')
      .doc(userId)
      .collection('logs')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit));

    // Filter by type if provided
    if (type) {
      query = db
        .collection('users')
        .doc(userId)
        .collection('logs')
        .where('type', '==', type)
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit));
    }

    const snapshot = await query.get();
    const logs = [];

    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...doc.data() });
    });

    return res.status(200).json({ success: true, logs });

  } catch (error) {
    console.error('Get logs error:', error);
    return res.status(500).json({ error: 'Failed to fetch logs', details: error.message });
  }
};
