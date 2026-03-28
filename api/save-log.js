const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin only once
if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = getFirestore();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, childName, type, data } = req.body;

  if (!userId || !type || !data) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const logEntry = {
      userId,
      childName: childName || 'My Child',
      type, // 'milestone' | 'trigger' | 'behavior' | 'note' | 'crisis'
      data,
      timestamp: new Date().toISOString(),
      createdAt: Date.now()
    };

    const docRef = await db
      .collection('users')
      .doc(userId)
      .collection('logs')
      .add(logEntry);

    return res.status(200).json({ 
      success: true, 
      logId: docRef.id,
      message: 'Log saved successfully'
    });

  } catch (error) {
    console.error('Save log error:', error);
    return res.status(500).json({ error: 'Failed to save log', details: error.message });
  }
};
