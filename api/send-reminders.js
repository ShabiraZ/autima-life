const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = getFirestore();

// ── Generate reminder message via OpenAI ──
async function generateReminder(childName, recentLogs) {
  const logSummary = recentLogs.map(log => {
    const d = log.data || {};
    const date = new Date(log.createdAt).toLocaleDateString('en-MY', {
      weekday: 'short', day: 'numeric', month: 'short'
    });

    if (log.type === 'trigger') {
      return `${date}: ${d.what || 'Episode'} | Time: ${d.time || '?'} | Food: ${d.food || '?'} | Trigger: ${d.trigger || '?'}`;
    }
    if (log.type === 'crisis') {
      const turns = (d.conversation || []).filter(m => m.role === 'user' && !m.content.includes('CRISIS MODE'));
      return `${date}: Crisis session — ${turns[0]?.content?.substring(0, 80) || 'episode'}`;
    }
    return `${date}: ${log.type} logged`;
  }).join('\n');

  const prompt = `You are AutiMa, a caring autism parent assistant.
Based on these recent logs for ${childName}, generate ONE short proactive reminder for the parent today.

Recent logs:
${logSummary}

Rules:
- Maximum 2 sentences
- Be warm and specific to what was logged — not generic
- Focus on preventing a trigger or celebrating a pattern
- Start with the child's name if known
- Do not say "based on your logs" — just give the insight naturally
- Example good reminder: "Lunch at 1pm helped avoid the afternoon meltdown yesterday. Today's looking similar — have something ready by 12:30."
- Example bad reminder: "Based on your logs, you should feed your child."

Generate only the reminder text, nothing else.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.7
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ── Send FCM push notification ──
async function sendPush(fcmToken, title, body) {
  const messaging = getMessaging();
  await messaging.send({
    token: fcmToken,
    notification: { title, body },
    webpush: {
      notification: {
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [100, 50, 100],
        requireInteraction: false
      },
      fcmOptions: { link: 'https://autima-life.vercel.app' }
    }
  });
}

// ── Main cron handler ──
module.exports = async function handler(req, res) {
  // Verify this is called by Vercel Cron (or authorized)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all users with notifications enabled and FCM tokens
    const usersSnap = await db.collection('users')
      .where('notificationsEnabled', '==', true)
      .get();

    if (usersSnap.empty) {
      return res.status(200).json({ message: 'No users with notifications enabled' });
    }

    const results = { sent: 0, skipped: 0, errors: 0 };

    // Process each user
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      const { fcmToken, childName } = userData;

      if (!fcmToken) { results.skipped++; continue; }

      try {
        // Get last 7 days of logs
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const logsSnap = await db
          .collection('users').doc(userId)
          .collection('logs')
          .where('createdAt', '>', sevenDaysAgo)
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get();

        if (logsSnap.empty) { results.skipped++; continue; }

        const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Generate personalised reminder
        const reminderText = await generateReminder(childName || 'your child', logs);
        if (!reminderText) { results.skipped++; continue; }

        // Send push notification
        await sendPush(
          fcmToken,
          '🌿 AutiMa.Life',
          reminderText
        );

        // Log that reminder was sent
        await db.collection('users').doc(userId)
          .collection('reminders')
          .add({
            message: reminderText,
            sentAt: Date.now(),
            basedOnLogs: logs.length
          });

        results.sent++;

      } catch (userError) {
        console.error(`Error for user ${userId}:`, userError.message);
        // If token is invalid, disable notifications for this user
        if (userError.code === 'messaging/invalid-registration-token' ||
            userError.code === 'messaging/registration-token-not-registered') {
          await db.collection('users').doc(userId).update({
            notificationsEnabled: false,
            fcmToken: null
          });
        }
        results.errors++;
      }
    }

    return res.status(200).json({
      success: true,
      ...results,
      message: `Reminders sent: ${results.sent}, skipped: ${results.skipped}, errors: ${results.errors}`
    });

  } catch (error) {
    console.error('Cron error:', error);
    return res.status(500).json({ error: 'Cron job failed', details: error.message });
  }
};
